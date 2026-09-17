import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

// Exercise the real installer with a fake CLI; never authenticate or create cloud resources.
function install(t, scenario){
  const root=mkdtempSync(join(tmpdir(),'cloudflare-login-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bin=join(root,'bin');mkdirSync(bin);
  cpSync(new URL('./deploy.mjs',import.meta.url),join(root,'deploy.mjs'));
  writeFileSync(join(root,'install-settings.json'),JSON.stringify({workerName:'test',databaseName:'test',kvNamespaceName:'test-files'}));
  cpSync(new URL('./wrangler.template.jsonc',import.meta.url),join(root,'wrangler.template.jsonc'));
  mkdirSync(join(root,'seed'));mkdirSync(join(root,'seed/assets'));
  writeFileSync(join(root,'seed/assets.json'),JSON.stringify([{id:'image1',type:'image/png'},{id:'image2',type:'image/png'}]));
  writeFileSync(join(root,'seed/assets/image1'),'123');writeFileSync(join(root,'seed/assets/image2'),'456');
  if(['legacy','switched','resume','missing-file'].includes(scenario)){
    const state={databaseId:'11111111-1111-4111-8111-111111111111',databaseReady:true,bucketCreated:true,assetsUploaded:true};
    if(scenario==='switched')state.accountId='b'.repeat(32);
    if(scenario==='resume'){state.accountId='a'.repeat(32);state.kvNamespaceId='c'.repeat(32);state.kvUploadedAssetIds=['image1'];}
    writeFileSync(join(root,'installation-state.json'),JSON.stringify(state));
  }
  writeFileSync(join(bin,'npx'),`#!${process.execPath}
import {appendFileSync, existsSync, writeFileSync} from 'node:fs';
const allArgs=process.argv.slice(2), args=allArgs.slice(0,allArgs.includes('--config')?allArgs.indexOf('--config'):undefined), scenario=process.env.TEST_SCENARIO;
appendFileSync('calls.jsonl', JSON.stringify(args)+'\\n');
if(args[1]==='whoami'){
  if(scenario==='whoami-error') process.exit(1);
  if(scenario==='existing'||(existsSync('logged-in')&&scenario!=='unverified')) console.log(JSON.stringify({loggedIn:true,accounts:[{id:'a'.repeat(32),name:'Test account'}]}));
  else process.exit(1);
}else if(args[1]==='login'){
  if(args[2]!=='--device') throw Error('Local callback login must not be used');
  if(scenario==='expired') process.exit(1);
  writeFileSync('logged-in','yes');
}else if(args[1]==='d1'&&args[2]==='list'){
  console.log(JSON.stringify(['legacy','resume','missing-file'].includes(scenario)?[{uuid:'11111111-1111-4111-8111-111111111111',name:'test'}]:[]));
}else if(args[1]==='kv'&&args[2]==='namespace'&&args[3]==='list'){
  console.log(JSON.stringify(scenario==='resume'?[{id:'c'.repeat(32),title:'test-files'}]:[]));
}else if(args[1]==='kv'&&args[2]==='namespace'&&args[3]==='create'){
  console.log(JSON.stringify({binding:'FILES',id:'c'.repeat(32)}));
}else if(args[1]==='d1'&&args.some(arg=>arg.startsWith('--command=SELECT id FROM pf_settings'))){
  console.log('[{"results":[]}]');
}else if(args[1]==='d1'&&args.some(arg=>arg.startsWith('--command=SELECT id,size'))){
  console.log(JSON.stringify([{results:scenario==='missing-file'?[{id:'new-upload',size:3}]:[{id:'image1',size:3},{id:'image2',size:3}]}]));
}else if(args[1]==='kv'&&args[2]==='key'&&args[4]==='assets/image2'&&scenario==='kv-fail'){
  process.exit(1);
}else if(args[1]==='r2'){
  throw Error('R2 must not be used');
}else if(args[1]==='d1'&&args[2]==='create'){
  console.log('database_id = 11111111-1111-4111-8111-111111111111');
}
`,{mode:0o755});
  const result=spawnSync(process.execPath,[join(root,'deploy.mjs')],{
    cwd:tmpdir(),encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,TEST_SCENARIO:scenario},
  });
  assert.ifError(result.error);
  return {...result,root,calls:readFileSync(join(root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse)};
}

test('new login uses a device code and verifies identity before provisioning',t=>{
  const result=install(t,'new');
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.calls.slice(0,3),[['wrangler','whoami','--json'],['wrangler','login','--device'],['wrangler','whoami','--json']]);
  assert.equal(result.calls[3][1],'d1');
  assert.equal(result.calls.at(-1)[1],'deploy');
});

test('an existing session is reused without another login',t=>{
  const result=install(t,'existing');
  assert.equal(result.status,0,result.stderr);
  assert.ok(!result.calls.some(args=>args[1]==='login'));
});

for(const scenario of ['expired','unverified','whoami-error']){
  test(scenario+': failed authorization stops before any resources or state are created',t=>{
    const result=install(t,scenario);
    assert.equal(result.status,1);
    assert.ok(result.calls.every(args=>['whoami','login'].includes(args[1])));
    assert.equal(existsSync(join(result.root,'installation-state.json')),false);
    assert.match(result.stderr,/Установка остановлена/);
    assert.doesNotMatch(result.stderr,/at execFileSync|node:internal|Command failed:/);
    if(scenario==='expired') assert.match(result.stderr,/повторно.*новый код/);
  });
}

test('shell launcher runs npm in its own directory even when called elsewhere',t=>{
  const root=mkdtempSync(join(tmpdir(),'cloudflare-shell-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const folder=join(root,'site with spaces'),bin=join(root,'bin');
  mkdirSync(folder);mkdirSync(bin);
  const script=join(folder,'install-cloudflare.sh');
  cpSync(new URL('./install-cloudflare.sh',import.meta.url),script);
  writeFileSync(join(bin,'npm'),'#!/bin/sh\npwd >> npm-cwd.txt\n',{mode:0o755});
  const result=spawnSync('sh',[script],{cwd:tmpdir(),encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH}});
  assert.equal(result.status,0,result.stderr);
  assert.equal(readFileSync(join(folder,'npm-cwd.txt'),'utf8'),folder+'\n'+folder+'\n');
});

for(const scenario of ['legacy','switched','resume']){
  test(scenario+': KV transition preserves the correct progress',t=>{
    const result=install(t,scenario);
    assert.equal(result.status,0,result.stderr);
    const state=JSON.parse(readFileSync(join(result.root,'installation-state.json'),'utf8'));
    assert.equal(state.storage,'kv');
    assert.equal(state.accountId,'a'.repeat(32));
    assert.ok(state.kvAssetsUploaded);
    assert.ok(!result.calls.some(args=>args[1]==='r2'));
    const puts=result.calls.filter(args=>args[1]==='kv'&&args[2]==='key');
    assert.equal(puts.length,scenario==='resume'?1:2);
    assert.ok(puts.every(args=>args.includes('--remote')&&args.some(arg=>arg.startsWith('--path='))));
    const seeds=result.calls.filter(args=>args.includes('--file=./seed/seed.sql'));
    assert.equal(seeds.length,scenario==='switched'?1:0);
    const config=JSON.parse(readFileSync(join(result.root,'wrangler.jsonc'),'utf8'));
    assert.equal(config.account_id,'a'.repeat(32));
    assert.equal(config.kv_namespaces[0].id,'c'.repeat(32));
    assert.equal(config.r2_buckets,undefined);
  });
}
for(const scenario of ['kv-fail','missing-file']){
  test(scenario+': incomplete files never reach deployment',t=>{
    const result=install(t,scenario);
    assert.equal(result.status,1);
    assert.ok(!result.calls.some(args=>args[1]==='deploy'));
    const state=JSON.parse(readFileSync(join(result.root,'installation-state.json'),'utf8'));
    assert.ok(!state.kvAssetsUploaded);
    if(scenario==='kv-fail')assert.deepEqual(state.kvUploadedAssetIds,['image1']);
    if(scenario==='missing-file')assert.match(result.stderr,/Нужен актуальный комплект/);
  });
}
