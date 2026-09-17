import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const origin=process.argv[2]||'http://127.0.0.1:8791',root=readFileSync(process.argv[3]||'INSTALL-KEY.txt','utf8').trim();
let assertions=0;const ok=(value,message='assertion failed')=>{assertions++;if(!value)throw Error(message)};
async function request(path,options={}){const response=await fetch(origin+path,options),type=response.headers.get('content-type')||'';return {response,status:response.status,data:type.includes('json')?await response.json():await response.arrayBuffer()}}
async function api(op,key,body){return request('/api/portfolio?op='+op,{method:'POST',headers:{Authorization:'Bearer '+key,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body??{})})}

let result=await request('/api/portfolio');ok(result.status===200, 'Public content status: '+result.status+' '+(result.data instanceof ArrayBuffer?Buffer.from(result.data).toString():JSON.stringify(result.data)).slice(0,500));ok(Number.isInteger(result.data.version));ok(result.data.works.length>=1);
const original=result.data;
result=await request(original.works[0].imageUrl);ok(result.status===200);ok(result.response.headers.get('x-content-type-options')==='nosniff');
ok((await api('login','x'.repeat(43))).status===401);
result=await api('login',root);ok(result.status===200);const session=result.data.token;ok(session.length===43);ok(result.data.expiresAt-Date.now()<=15*60*1000);
ok((await api('history',root)).status===401);ok((await api('history',session)).status===200);
ok((await request('/api/portfolio?op=history',{method:'POST',headers:{Origin:'https://evil.example',Authorization:'Bearer '+session,'Content-Type':'application/json'},body:'{}'})).status===403);
ok((await request('/api/portfolio?op=upload',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+session,'Content-Type':'image/png'},body:'not an image'})).status===400);
const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
result=await request('/api/portfolio?op=upload',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+session,'Content-Type':'image/png'},body:png});ok(result.status===200);const uploaded=result.data;
result=await request(uploaded.url);ok(result.status===200);ok(Buffer.from(result.data).equals(png),'KV must preserve PNG bytes');
result=await request(uploaded.url,{method:'HEAD'});ok(result.status===200);ok(result.data.byteLength===0);ok(result.response.headers.get('content-length')===String(png.length));
const pdf=Buffer.from('%PDF-1.4\n\0binary\xff','latin1');
result=await request('/api/portfolio?op=upload',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+session,'Content-Type':'application/pdf'},body:pdf});ok(result.status===200);const uploadedPdf=result.data;
result=await request(uploadedPdf.url);ok(result.status===200);ok(Buffer.from(result.data).equals(pdf));ok(result.response.headers.get('content-disposition').startsWith('attachment;'));
const changed=structuredClone(original.content);changed.about+=' Тест Cloudflare.';
result=await api('save',session,{version:original.version,content:changed});ok(result.status===200);const changedVersion=original.version+1;ok(result.data.version===changedVersion);
ok((await api('save',session,{version:original.version,content:changed})).status===409);
result=await api('revision',session,{version:changedVersion});ok(result.status===200);ok(result.data.about.endsWith('Тест Cloudflare.'));
result=await api('save',session,{version:changedVersion,content:original.content});ok(result.status===200);ok(result.data.version===changedVersion+1);
result=await request('/api/portfolio');ok(result.data.content.about===original.content.about);
result=await request('/api/portfolio?op=backup',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+session}});ok(result.status===200);const backup=result.data;ok(backup.format==='lazysoft-portfolio-backup-v1');
ok(Buffer.from(backup.assets.find(asset=>asset.id===uploaded.storageId).bytes,'base64').equals(png),'backup must include the complete binary file');
ok(Buffer.from(backup.assets.find(asset=>asset.id===uploadedPdf.storageId).bytes,'base64').equals(pdf));
const second=(await api('login',root)).data.token;ok((await api('revoke',session)).status===200);ok((await api('history',second)).status===401);
result=await api('login',root);const rotateSession=result.data.token,newKey=randomBytes(32).toString('base64url');ok((await api('rotate',rotateSession,{newKey})).status===200);
result=await api('login',newKey);ok(result.status===200);ok((await api('rotate',result.data.token,{newKey:root})).status===200);
console.log(`PASS: ${assertions} checks — content, KV binary assets, HEAD, PDF, sessions, origin, uploads, versions, history, backup, revocation and rotation.`);
