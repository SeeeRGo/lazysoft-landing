// Build a self-contained PHP/MySQL handover. No existing credentials are exported.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
if(!process.argv[2])throw Error('Usage: node scripts/package-portfolio-sprinthost.mjs <snapshot/data>');
const db=new DatabaseSync(resolve(process.argv[2],'portfolio.sqlite'),{readOnly:true});
let seed;
try{
 db.exec('BEGIN');
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Corrupted source snapshot');
 const row=db.prepare('SELECT * FROM content').get();
 seed={version:row?.version??0,content:row?JSON.parse(row.json):null,
  assets:db.prepare('SELECT * FROM assets').all().map(a=>({...a,bytes:Buffer.from(a.bytes).toString('base64')})),
  history:db.prepare('SELECT event,created,version,json FROM history ORDER BY id').all().map(({json,...r})=>({...r,content:json?JSON.parse(json):null}))};
 db.exec('COMMIT');
}finally{db.close()}
const dir=mkdtempSync(resolve('.local/portfolio-sprinthost-'));chmodSync(dir,0o700);
const site=join(dir,'site');mkdirSync(site,{mode:0o700});
for(const name of ['private','public_html','schema.sql','README.md'])cpSync(join('standalone/portfolio-sprinthost',name),join(site,name),{recursive:true});
for(const name of ['index.html','covers.html','spreads.html','magazines.html','logos.html','admin.html','categories-v2.css','gallery-v2.js','admin-v1.css','admin-v1.js','content-v1.js']){
 let body=readFileSync(join('standalone/portfolio/public',name),'utf8');
 if(name.endsWith('.js'))body=body.replaceAll("'/api/portfolio'","'/api.php'");
 writeFileSync(join(site,'public_html',name),body);
}
writeFileSync(join(site,'private/seed.json'),JSON.stringify(seed),{mode:0o600});
const key=randomBytes(32).toString('base64url');
const example=readFileSync(join(site,'private/config.example.php'),'utf8').replace('REPLACE_WITH_GENERATED_HASH',createHash('sha256').update(key).digest('hex'));
writeFileSync(join(site,'private/config.php'),example,{mode:0o600});
writeFileSync(join(site,'INSTALL-KEY.txt'),key+'\n',{mode:0o600});
const archive=join(dir,'portfolio-sprinthost.tar.gz');
execFileSync('tar',['-czf',archive,'-C',dir,'site']);chmodSync(archive,0o600);
console.log(JSON.stringify({archive,directory:site,version:seed.version,assets:seed.assets.length}));
