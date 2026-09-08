import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync,symlinkSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backup,DatabaseSync} from 'node:sqlite';
import {createApp} from './server.mjs';

const rootKey='k'.repeat(43),replacement='n'.repeat(43);
async function fixture(t){
 const dataDir=mkdtempSync(join(tmpdir(),'portable-portfolio-test-'));
 let app=createApp({dataDir,initialKey:rootKey});
 async function listen(){await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.server.address().port}
 let origin=await listen();
 t.after(async()=>{await app.close();rmSync(dataDir,{recursive:true,force:true})});
 return {
  get db(){return app.db},dataDir,
  request:(path,options)=>fetch(origin+path,options),
  async post(op,token=rootKey,body={}){return fetch(origin+'/api/portfolio?op='+op,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)})},
  async restart(){await app.close();app=createApp({dataDir,initialKey:rootKey});origin=await listen()},
 };
}
async function login(f,key=rootKey){const r=await f.post('login',key);assert.equal(r.status,200);return r.json()}
const content={name:'Test author',headline:'Portfolio',about:'Description',email:'author@example.com',telegram:'@author',prices:'By agreement',works:[]};

test('isolated package: pages, security headers, no secrets/static traversal',async t=>{
 const f=await fixture(t);
 for(const path of ['/','/admin.html','/covers.html','/content-v1.js']){const r=await f.request(path);assert.equal(r.status,200);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/)}
 for(const path of ['/data/portfolio.sqlite','/data/initial-admin-key.txt','/server.mjs','/.env','/hosting.json','/../server.mjs','/public/../server.mjs'])assert.equal((await f.request(path)).status,404);
 const r=await f.request('/api/portfolio?op=login',{method:'POST',headers:{Origin:'https://attacker.example',Authorization:'Bearer '+rootKey}});assert.equal(r.status,403);
 const js=await (await f.request('/content-v1.js')).text();assert.ok(js.includes("'/api/portfolio'"));assert.ok(!js.includes('convex'));
});
test('15-minute opaque session, root key cannot bypass session, expiry/revocation/rotation persist',async t=>{
 const f=await fixture(t),s=await login(f);
 assert.match(s.token,/^[A-Za-z0-9_-]{43}$/);assert.ok(s.expiresAt>Date.now()+899000&&s.expiresAt<=Date.now()+900000);
 assert.equal((await f.post('history')).status,401);
 assert.equal((await f.post('history',s.token)).status,200);
 await f.restart();assert.equal((await f.post('history',s.token)).status,200);
 f.db.prepare('UPDATE sessions SET expires=?').run(Date.now()-1);assert.equal((await f.post('history',s.token)).status,401);
 const a=await login(f),b=await login(f);
 assert.equal((await f.post('revoke',a.token)).status,200);assert.equal((await f.post('history',b.token)).status,401);
 const c=await login(f);assert.equal((await f.post('rotate',c.token,{newKey:replacement})).status,200);
 assert.equal((await f.post('history',c.token)).status,401);
 assert.equal((await f.post('login',rootKey)).status,401);
 f.db.exec('DELETE FROM limits');await f.restart();await login(f,replacement);
});
test('upload, publish, history, conflict, disk persistence, consistent backup',async t=>{
 const f=await fixture(t),s=await login(f);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
 const upload=await f.request('/api/portfolio?op=upload',{method:'POST',headers:{Authorization:'Bearer '+s.token,'Content-Type':'image/png'},body:png});assert.equal(upload.status,200);const asset=await upload.json();
 const c={...content,works:[{id:'work-1',category:'spreads',title:'First work',description:'Description',image:asset.storageId}]};
 const publish=await f.post('save',s.token,{version:0,content:c});assert.equal(publish.status,200);assert.deepEqual(await publish.json(),{version:1});
 assert.equal((await f.post('save',s.token,{version:0,content:c})).status,409);
 assert.equal((await f.post('save',s.token,{version:1,content:{...c,headline:'Updated'}})).status,200);
 const history=await (await f.post('history',s.token)).json();assert.equal(history.filter(r=>r.version).length,2);
 assert.deepEqual(await (await f.post('revision',s.token,{version:1})).json(),c);
 await f.restart();
 const published=await (await f.request('/api/portfolio')).json();assert.equal(published.version,2);assert.equal(published.content.headline,'Updated');
 const image=await f.request(published.works[0].imageUrl);assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
 const file=join(f.dataDir,'backup.sqlite');await backup(f.db,file);const restored=new DatabaseSync(file);
 try{assert.equal(restored.prepare('SELECT version FROM content').get().version,2);assert.equal(restored.prepare('SELECT count(*) AS n FROM assets').get().n,1);assert.equal(restored.prepare('SELECT count(*) AS n FROM history WHERE version IS NOT NULL').get().n,2)}finally{restored.close()}
});
test('validation, attachment format/size and file ownership',async t=>{
 const f=await fixture(t),s=await login(f);
 for(const c of [{...content,telegram:'javascript:alert(1)'},{...content,name:''},{...content,works:[{id:'x',category:'logos',title:'x',description:'',image:'unknown'}]}])assert.equal((await f.post('save',s.token,{version:0,content:c})).status,400);
 const headers={Authorization:'Bearer '+s.token,'Content-Type':'image/png'};
 assert.equal((await f.request('/api/portfolio?op=upload',{method:'POST',headers,body:'<script>bad</script>'})).status,400);
 assert.equal((await f.request('/api/portfolio?op=upload',{method:'POST',headers,body:Buffer.alloc(8*1024*1024+1)})).status,413);
 const pdf=await f.request('/api/portfolio?op=upload',{method:'POST',headers:{...headers,'Content-Type':'application/pdf'},body:'%PDF-1.4 test'});assert.equal(pdf.status,200);
 const asset=await pdf.json(),r=await f.request(asset.url);assert.match(r.headers.get('content-disposition'),/^attachment/);
});
test('login and upload throttles are persistent across restarts',async t=>{
 const f=await fixture(t);
 for(let i=0;i<5;i++)assert.equal((await f.post('login','wrong')).status,401);
 await f.restart();const r=await f.post('login');assert.equal(r.status,429);assert.ok(Number(r.headers.get('retry-after'))>=1);
 f.db.exec('DELETE FROM limits');const s=await login(f);
 for(let i=0;i<10;i++)assert.equal((await f.request('/api/portfolio?op=upload',{method:'POST',headers:{Authorization:'Bearer '+s.token,'Content-Type':'text/html'},body:'bad'})).status,400);
 await f.restart();assert.equal((await f.request('/api/portfolio?op=upload',{method:'POST',headers:{Authorization:'Bearer '+s.token}})).status,429);
});
test('portable frontend has no hosted backend or remote script/style dependencies',()=>{
 for(const name of readdirSync(new URL('./public/',import.meta.url))){const s=readFileSync(new URL('./public/'+name,import.meta.url),'utf8');assert.ok(!/convex\.(site|cloud)|storage\.yandexcloud\.net/.test(s),name);assert.ok(!/<(?:script|link)[^>]+(?:src|href)=["']https?:/i.test(s),name)}
});
test('CLI startup through a release symlink (systemd deployment)',{timeout:10000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'portfolio-startup-test-'));
 symlinkSync(fileURLToPath(new URL('./server.mjs',import.meta.url)),join(dir,'server.mjs'));
 const child=spawn(process.execPath,[join(dir,'server.mjs')],{env:{...process.env,DATA_DIR:join(dir,'data'),PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 const closed=new Promise(r=>child.once('close',r));
 try{
  await new Promise((resolve,reject)=>{
   let output='';const timer=setTimeout(()=>reject(Error('Startup timed out')),5000);
   child.once('error',e=>{clearTimeout(timer);reject(e)});
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited before listen'))});
   child.stdout.on('data',d=>{output+=d;if(output.includes('Portfolio server started')){clearTimeout(timer);resolve()}});
  });
 }finally{child.kill('SIGTERM');await closed;rmSync(dir,{recursive:true,force:true})}
});
