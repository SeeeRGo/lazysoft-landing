// Build the no-SSH Beget Free PHP/MySQL handover from a trusted SQLite snapshot.
import {DatabaseSync} from '../standalone/portfolio/sqlite-compat.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,chmodSync,renameSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const input=resolve(process.argv[2]||'');
if(!process.argv[2]||!existsSync(join(input,'portfolio.sqlite')))throw Error('Usage: node --experimental-sqlite scripts/package-portfolio-beget-free.mjs <snapshot/data>');
const db=new DatabaseSync(join(input,'portfolio.sqlite'),{readOnly:true});let seed;
try{
 db.exec('BEGIN');if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Corrupted source snapshot');
 const row=db.prepare('SELECT * FROM content').get();
 seed={version:row?.version??0,content:row?JSON.parse(row.json):null,assets:db.prepare('SELECT * FROM assets').all().map(a=>({...a,bytes:Buffer.from(a.bytes).toString('base64')})),history:db.prepare('SELECT event,created,version,json FROM history ORDER BY id').all().map(({json,...r})=>({...r,content:json?JSON.parse(json):null}))};db.exec('COMMIT');
}finally{db.close()}
const source=resolve('standalone/portfolio-beget-free'),dir=mkdtempSync(resolve('.local/portfolio-beget-free-'));chmodSync(dir,0o700);
for(const name of ['private','public_html','schema.sql','README.md'])cpSync(join(source,name),join(dir,name),{recursive:true});
renameSync(join(dir,'schema.sql'),join(dir,'private/schema.sql'));
for(const name of ['index.html','covers.html','spreads.html','magazines.html','logos.html','admin.html','categories-v2.css','gallery-v2.js','admin-v1.css','admin-v1.js','content-v1.js']){
 let body=readFileSync(join('standalone/portfolio/public',name),'utf8');if(name.endsWith('.js'))body=body.replaceAll("'/api/portfolio'","'/api.php'");writeFileSync(join(dir,'public_html',name),body);
}
writeFileSync(join(dir,'private/seed.json'),JSON.stringify(seed),{mode:0o600});
const key=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(key).digest('hex');
writeFileSync(join(dir,'private/setup.php'),`<?php\nreturn ['setup_key_hash'=>'${hash}'];\n`,{mode:0o600});
writeFileSync(join(dir,'INSTALL-KEY.txt'),key+'\n',{mode:0o600});
const guide=resolve('artifacts/archive/instructions/portfolio-beget-free-guide.pdf');if(existsSync(guide))cpSync(guide,join(dir,'ИНСТРУКЦИЯ-BEGET.pdf'));
const archive=join(dir,'portfolio-beget-free.zip'),entries=['public_html','private','INSTALL-KEY.txt','README.md',...(existsSync(guide)?['ИНСТРУКЦИЯ-BEGET.pdf']:[])];
execFileSync('zip',['-q','-r','-9',archive,...entries],{cwd:dir});chmodSync(archive,0o600);
console.log(JSON.stringify({archive,directory:dir,version:seed.version,assets:seed.assets.length}));
