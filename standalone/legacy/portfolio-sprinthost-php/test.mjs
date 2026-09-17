// Integration suite against isolated test containers, never production.
// node standalone/portfolio-sprinthost/test.mjs <site-package-dir> <port> <db-container> <php-container>
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const [site,port,dbContainer,phpContainer]=process.argv.slice(2);
if(!site||!/^portfolio-sprint-test-/.test(dbContainer)||!/^portfolio-sprint-test-/.test(phpContainer))throw Error('Use isolated test containers only');
let base='http://127.0.0.1:'+port;
const origin='https://test.example',root=readFileSync(site+'/INSTALL-KEY.txt','utf8').trim();
const sql=s=>execFileSync('docker',['exec',dbContainer,'mariadb','-uroot','-ptest-only','portfolio','-e',s],{stdio:['ignore','pipe','pipe']}).toString();
let assertions=0;
function ok(v){assert.ok(v);assertions++}
async function request(path,options={}){const r=await fetch(base+path,options);const t=await r.text();let d;try{d=JSON.parse(t)}catch{d=t}return {status:r.status,data:d,headers:r.headers}}
async function api(op,key,body,extra={}){return request('/api.php?op='+op,{method:'POST',headers:{Authorization:'Bearer '+key,Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body??{})})}
const seed=JSON.parse(readFileSync(site+'/private/seed.json','utf8'));
ok((await api('save',root,{})).status===401);
ok((await request('/install.php',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'key=bad'})).status===401);
let r=await request('/install.php',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'key='+root});ok(r.status===200);
ok((await request('/install.php',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'key='+root})).status===409);
r=await request('/api.php');ok(r.status===200&&r.data.version===seed.version);ok(r.data.works.length===seed.content.works.length);
for(const a of seed.assets){const res=await fetch(base+'/asset.php?id='+a.id);ok(res.ok);ok(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(a.bytes,'base64')))}
for(const path of ['/private/config.php','/private/seed.json','/schema.sql','/INSTALL-KEY.txt','/.env'])ok((await request(path)).status===404);
ok((await api('login',root,{}, {Origin:'https://evil.example'})).status===403);
r=await api('login',root);ok(r.status===200&&r.data.token.length===43);let key=r.data.token;
ok(r.data.expiresAt>Date.now()&&r.data.expiresAt<=Date.now()+900000);
ok((await api('history',root)).status===401); // root is not a session
ok((await api('history',key)).status===200);
ok((await request('/api.php?op=save',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{bad'})).status===400);
const original=(await request('/api.php')).data;
ok((await api('save',key,{version:original.version,content:{...original.content,works:[{id:'bad'}]}})).status===400);
ok((await request('/api.php?op=upload',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'image/png'},body:'<script>alert(1)</script>'})).status===400);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ5kAAAAASUVORK5CYII=','base64');
r=await request('/api.php?op=upload',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'image/png'},body:png});ok(r.status===200);const img=r.data.storageId;
const pdf=Buffer.from('%PDF-1.4\n%%EOF');
r=await request('/api.php?op=upload',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'application/pdf'},body:pdf});ok(r.status===200);const document=r.data.storageId;
r=await request(r.data.url);ok(r.headers.get('content-disposition').startsWith('attachment'));ok(r.headers.get('x-content-type-options')==='nosniff');
const content={...original.content,name:'Тест переноса',works:[...original.content.works,{id:'integration-test',category:'magazines',title:'Тестовая работа',description:'Проверка',image:img,document}]};
const outcomes=await Promise.all([api('save',key,{version:original.version,content}),api('save',key,{version:original.version,content})]);ok(outcomes.filter(x=>x.status===200).length===1);ok(outcomes.filter(x=>x.status===409).length===1);
r=await api('history',key);ok(r.data.some(x=>x.version===original.version+1));
r=await api('revision',key,{version:original.version});ok(r.data.name===original.content.name);
// Restore original content through versioned save (keeps history).
ok((await api('save',key,{version:original.version+1,content:original.content})).status===200);
const second=await api('login',root);ok(second.status===200);
ok((await api('revoke',key)).status===200);ok((await api('history',second.data.token)).status===401);
sql('DELETE FROM pf_limits');
key=(await api('login',root)).data.token;
sql('UPDATE pf_sessions SET expires=0');ok((await api('history',key)).status===401);
key=(await api('login',root)).data.token;
const newKey=randomBytes(32).toString('base64url');ok((await api('rotate',key,{newKey})).status===200);
ok((await api('history',key)).status===401);ok((await api('login',root)).status===401);ok((await api('login',newKey)).status===200);
ok((await request('/install.php',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'key='+root})).status===409);
sql('DELETE FROM pf_limits');
for(let i=0;i<5;i++)ok((await api('login','wrong')).status===401);
ok((await api('login',newKey)).status===429);
sql('DELETE FROM pf_limits');
// 8 MiB upload succeeds through real PDO/MySQL; overflow rejected without storing it.
key=(await api('login',newKey)).data.token;
const large=Buffer.alloc(8*1024*1024);png.copy(large);
ok((await request('/api.php?op=upload',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'image/png'},body:large})).status===200);
ok((await request('/api.php?op=upload',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'image/png'},body:Buffer.concat([large,Buffer.from('x')])})).status===413);
execFileSync('docker',['restart',phpContainer],{stdio:'pipe'});
base='http://127.0.0.1:'+execFileSync('docker',['port',phpContainer,'8080'],{encoding:'utf8'}).trim().split(':').at(-1);
for(let i=0;i<30;i++){try{r=await request('/api.php');if(r.status===200)break}catch{}await new Promise(r=>setTimeout(r,200))}
ok(r.data.content.name===original.content.name);
sql('DELETE FROM pf_limits');
key=(await api('login',newKey)).data.token;
ok((await api('rotate',key,{newKey:root})).status===200);
sql('DELETE FROM pf_limits');
console.log(`PASS: ${assertions} checks — import, assets, edits, concurrency, history, revocation, expiry, rotation, rate limits, size limits, restart, private paths.`);
