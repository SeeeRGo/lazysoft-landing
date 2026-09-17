// Fully local checks against an extracted Cloudflare package. No cloud account is used.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';

const root=resolve(process.argv[2]||'artifacts/1');
const require=createRequire(join(root,'package.json'));
const {Miniflare,convertV4MiniflareOptions,Log,LogLevel}=require('miniflare');
const mf=new Miniflare(convertV4MiniflareOptions({
  host:'127.0.0.1',port:8791,log:new Log(LogLevel.INFO),
  workers:[{
  name:'kv-test',modules:true,scriptPath:join(root,'src/worker.js'),compatibilityDate:'2026-09-11',
  d1Databases:['DB'],kvNamespaces:['FILES'],
  assets:{directory:join(root,'public'),binding:'ASSETS',routerConfig:{has_user_worker:true},run_worker_first:['/api/*']},
  }],
}));
try{
  const db=await mf.getD1Database('DB'), files=await mf.getKVNamespace('FILES');
  for(const sql of readFileSync(join(root,'schema.sql'),'utf8').split(';').filter(x=>x.trim()))await db.prepare(sql).run();
  await db.batch(readFileSync(join(root,'seed/seed.sql'),'utf8').split('\n').filter(x=>x.trim()).map(sql=>db.prepare(sql)));
  const manifest=JSON.parse(readFileSync(join(root,'seed/assets.json'),'utf8'));
  for(const asset of manifest)await files.put('assets/'+asset.id,readFileSync(join(root,'seed/assets',asset.id)));
  const origin=(await mf.ready).origin;
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[resolvePath('standalone/portfolio-cloudflare/test.mjs'),origin,join(root,'INSTALL-KEY.txt')],{stdio:'inherit'});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('HTTP integration tests failed: '+code)));
  });
  await db.prepare('DELETE FROM pf_limits').run();
  const key=readFileSync(join(root,'INSTALL-KEY.txt'),'utf8').trim();
  const login=await fetch(origin+'/api/portfolio?op=login',{method:'POST',headers:{Authorization:'Bearer '+key,Origin:origin}});
  assert.equal(login.status,200);
  const {token}=await login.json();
  await db.prepare('INSERT INTO pf_assets(id,type,size,created) VALUES(?,?,?,?)').bind('pending-file','image/png',3,Date.now()).run();
  const pending=await fetch(origin+'/api/portfolio/assets/pending-file');
  assert.equal(pending.status,503);assert.equal(pending.headers.get('retry-after'),'60');assert.equal(pending.headers.get('cache-control'),'no-store');
  const backup=await fetch(origin+'/api/portfolio?op=backup',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin}});
  assert.equal(backup.status,503,'Unavailable KV files must not silently disappear from a backup');
  await db.prepare('DELETE FROM pf_assets WHERE id=?').bind('pending-file').run();
  const worker=(await import(pathToFileURL(join(root,'src/worker.js')).href)).default;
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0xff]);
  const upload=()=>new Request(origin+'/api/portfolio?op=upload',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'image/png'},body:png});
  const before=await db.prepare('SELECT asset_count,asset_bytes FROM pf_settings WHERE id=1').first();
  let expectedErrorCount=0;
  const originalError=console.error;console.error=()=>{expectedErrorCount++};
  try{
    const failed=await worker.fetch(upload(),{DB:db,FILES:{put:async()=>{throw Error('KV daily write quota exceeded')}}});
    assert.equal(failed.status,503);
    assert.deepEqual(await db.prepare('SELECT asset_count,asset_bytes FROM pf_settings WHERE id=1').first(),before);
    let storedKey,deletedKey;
    const rolledBack=await worker.fetch(upload(),{
      DB:{prepare:sql=>db.prepare(sql),batch:async()=>{throw Error('D1 unavailable')}},
      FILES:{put:async(name,bytes)=>{storedKey=name;await files.put(name,bytes)},delete:async name=>{deletedKey=name;await files.delete(name)}},
    });
    assert.equal(rolledBack.status,503);assert.equal(storedKey,deletedKey);assert.equal(await files.get(storedKey),null);
  }finally{console.error=originalError}
  assert.equal(expectedErrorCount,2);
  for(const path of ['/','/admin.html','/covers.html','/admin-v1.js'])assert.equal((await fetch(origin+path)).status,200,path);
  console.log('PASS: missing-file handling, complete backups, quota failure, rollback and static pages; local D1 + KV only.');
  if(process.argv.includes('--serve')){
    console.log('LOCAL_VISUAL_CHECK '+origin);
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve)});
  }
}finally{await mf.dispose()}
function resolvePath(path){return resolve(path)}
