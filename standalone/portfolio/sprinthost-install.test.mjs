import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,readdirSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from './sqlite-compat.mjs';
import {listSites,install,runtimeSupported} from './sprinthost-install.mjs';
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'sprinthost-installer-test-')),home=join(root,'home'),app=join(home,'portfolio'),site=join(home,'domains/example.xsph.ru');
 mkdirSync(app,{recursive:true});mkdirSync(site,{recursive:true});mkdirSync(join(app,'data'));
 for(const file of ['server.mjs','sqlite-compat.mjs'])cpSync(new URL(file,import.meta.url),join(app,file));
 const d=new DatabaseSync(join(app,'data/portfolio.sqlite'));d.exec('CREATE TABLE content(id INTEGER PRIMARY KEY,version INTEGER,json TEXT); INSERT INTO content VALUES(1,7,\'{}\')');d.close();
 t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,home,app,site};
}
test('runtime and safe site discovery',t=>{
 const f=fixture(t);assert.equal(runtimeSupported('22.5.0'),true);assert.equal(runtimeSupported('22.4.1'),false);assert.equal(runtimeSupported('23.1.0'),false);
 assert.deepEqual(listSites(f.home),[f.site]);
});
test('installer creates isolated Passenger root, key and settings without deleting old public files',async t=>{
 const f=fixture(t),publicRoot=join(f.site,'public_html');mkdirSync(publicRoot);writeFileSync(join(publicRoot,'old.html'),'old');
 const r=await install({appRoot:f.app,siteRoot:f.site,origin:'https://example.xsph.ru',runtime:process.execPath,replace:true,checkHttps:async()=>true});
 assert.match(readFileSync(join(publicRoot,'.htaccess'),'utf8'),/PassengerStartupFile passenger\.cjs/);assert.match(readFileSync(join(publicRoot,'.htaccess'),'utf8'),/PassengerNodejs/);
 assert.ok(readFileSync(r.oldPublic+'/old.html','utf8')==='old');assert.match(readFileSync(join(f.app,'ADMIN-KEY.txt'),'utf8').trim(),/^[A-Za-z0-9_-]{43}$/);
 const c=JSON.parse(readFileSync(join(f.app,'hosting.json'),'utf8'));assert.equal(c.publicOrigin,'https://example.xsph.ru');assert.equal(c.publicRoot,publicRoot);
 const d=new DatabaseSync(join(f.app,'data/portfolio.sqlite'));try{assert.equal(d.prepare('SELECT count(*) n FROM settings').get().n,1);assert.equal(d.prepare('SELECT version FROM content').get().version,7)}finally{d.close()}
 const again=await install({appRoot:f.app,siteRoot:f.site,origin:'https://example.xsph.ru',runtime:process.execPath,replace:false,checkHttps:async()=>{throw Error('must not run')}});assert.equal(again.alreadyInstalled,true);
});
test('installer refuses public app root, old key, unsupported runtime and occupied public root without confirmation',async t=>{
 const f=fixture(t);mkdirSync(join(f.site,'public_html'));writeFileSync(join(f.site,'public_html/index.html'),'old');
 await assert.rejects(install({appRoot:f.app,siteRoot:f.site,origin:'https://example.xsph.ru',runtime:process.execPath,checkHttps:async()=>true}),/есть файлы/);
 assert.equal(readFileSync(join(f.site,'public_html/index.html'),'utf8'),'old');assert.ok(!readdirSync(f.app).includes('ADMIN-KEY.txt'));
 await assert.rejects(install({appRoot:join(f.site,'public_html'),siteRoot:f.site,origin:'https://example.xsph.ru',runtime:process.execPath,replace:true,checkHttps:async()=>true}),/НЕ внутри/);
 writeFileSync(join(f.app,'ADMIN-KEY.txt'),'old');chmodSync(join(f.app,'ADMIN-KEY.txt'),0o600);
 await assert.rejects(install({appRoot:f.app,siteRoot:f.site,origin:'https://example.xsph.ru',runtime:process.execPath,replace:true,checkHttps:async()=>true}),/уже существует/);
});
