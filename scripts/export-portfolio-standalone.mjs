// Operator-only, read-only migration. NEVER bundled with the customer's site.
// Reads only portfolio 03212396; no request tables, credentials or sessions.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {openDatabase,transaction,validateContent,validFile} from '../standalone/portfolio/server.mjs';
const query=`
const slug='03212396';
const row=await ctx.db.query('portfolios').withIndex('by_slug',q=>q.eq('slug',slug)).unique();
const assets=await ctx.db.query('portfolioAssets').withIndex('by_slug',q=>q.eq('slug',slug)).take(101);
const history=await ctx.db.query('portfolioHistory').withIndex('by_slug',q=>q.eq('slug',slug)).take(1001);
if(assets.length>100||history.length>1000)throw Error('Export limit reached: use paginated export, do not truncate history');
return {row:row?{content:row.content,version:row.version}:null,
 assets:await Promise.all(assets.map(async a=>({id:a.storageId,type:a.type,size:a.size,url:await ctx.storage.getUrl(a.storageId)}))),
 history:history.map(h=>({event:h.event,createdAt:h.createdAt,...(h.version!==undefined?{version:h.version,content:h.content}:{})}))};`;
function snapshot(){
 try{return JSON.parse(execFileSync(resolve('node_modules/.bin/convex'),['run','--prod','--inline-query',query],{encoding:'utf8',maxBuffer:20*1024*1024,timeout:60000,stdio:['ignore','pipe','pipe']}))}
 catch{throw Error('Read-only export failed. Check Convex CLI access; no production changes were made.')}
}
function identity(s){return JSON.stringify({...s,assets:s.assets.map(({url,...a})=>a)})}
const before=snapshot();if(!before.row)throw Error('Portfolio has no published content');
const files=[];let total=0;
for(const a of before.assets){
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(a.id)||!a.url||new URL(a.url).protocol!=='https:')throw Error('Invalid asset metadata');
 const response=await fetch(a.url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Cannot download portfolio asset');
 const chunks=[];let size=0;
 for await(const part of response.body){size+=part.length;if(size>8*1024*1024)throw Error('Asset exceeds 8 MiB');chunks.push(part)}
 const bytes=Buffer.concat(chunks);total+=bytes.length;
 if(size!==a.size||!validFile(a.type,bytes)||total>100*1024*1024)throw Error('Asset verification failed');
 files.push({...a,bytes});
}
if(identity(snapshot())!==identity(before))throw Error('Portfolio changed during export. Run again; current site was not changed.');
mkdirSync(resolve('.local'),{recursive:true});
const target=mkdtempSync(resolve('.local/portable-portfolio-')),dataDir=join(target,'data');chmodSync(target,0o700);
const db=openDatabase(dataDir);
try{
 transaction(db,()=>{
  for(const a of files)db.prepare('INSERT INTO assets VALUES(?,?,?)').run(a.id,a.type,a.bytes);
  const c=validateContent(db,before.row.content);
  db.prepare('INSERT INTO content VALUES(1,?,?)').run(before.row.version,JSON.stringify(c));
  for(const h of before.history){const content=h.content?validateContent(db,h.content):null;db.prepare('INSERT INTO history(event,created,version,json) VALUES(?,?,?,?)').run(h.event,h.createdAt,h.version??null,content?JSON.stringify(content):null)}
 });
 db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
 console.log(JSON.stringify({directory:target,version:before.row.version,works:before.row.content.works.length,assets:files.length,history:before.history.length,bytes:total,credentialsExported:false,productionModified:false}));
}finally{db.close()}
