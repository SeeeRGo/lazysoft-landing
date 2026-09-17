// Build a personalized Cloudflare Workers handover from a trusted SQLite snapshot.
import {DatabaseSync} from '../standalone/portfolio/sqlite-compat.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,mkdirSync,chmodSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';

const input=resolve(process.argv[2]||'');
if(!process.argv[2]||!existsSync(join(input,'portfolio.sqlite')))throw Error('Usage: node --experimental-sqlite scripts/package-portfolio-cloudflare.mjs <snapshot/data>');
const db=new DatabaseSync(join(input,'portfolio.sqlite'),{readOnly:true});let seed;
try{
 db.exec('BEGIN');if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Corrupted source snapshot');
 const row=db.prepare('SELECT version,json FROM content WHERE id=1').get();
 seed={version:row?.version??0,content:row?JSON.parse(row.json):null,assets:db.prepare('SELECT id,type,bytes FROM assets').all(),history:db.prepare('SELECT event,created,version,json FROM history ORDER BY id').all()};
 db.exec('COMMIT');
}finally{db.close()}

const suffix=randomBytes(3).toString('hex');
const names={workerName:'portfolio-'+suffix,databaseName:'portfolio-'+suffix,kvNamespaceName:'portfolio-'+suffix+'-files'};
const source=resolve('standalone/portfolio-cloudflare'),dir=mkdtempSync(resolve('.local/portfolio-cloudflare-'));chmodSync(dir,0o700);
for(const name of ['src','schema.sql','package.json','wrangler.template.jsonc','deploy.mjs','test.mjs','install-cloudflare.cmd','install-cloudflare.sh','README.md','.gitignore'])cpSync(join(source,name),join(dir,name),{recursive:true});
mkdirSync(join(dir,'public'));mkdirSync(join(dir,'seed'));mkdirSync(join(dir,'seed/assets'));
for(const name of ['index.html','covers.html','spreads.html','magazines.html','logos.html','admin.html','categories-v2.css','gallery-v2.js','admin-v1.css','admin-v1.js','content-v1.js']){
 let body=readFileSync(join('standalone/portfolio/public',name),'utf8');
 if(name==='admin-v1.js')body=body.replace("+'.sqlite'","+'.json'").replace('Файл загружен. Нажмите «Опубликовать изменения».','Файл загружен. Нажмите «Опубликовать изменения». Его появление на сайте может занять минуту или больше.');
 if(name==='admin.html')body=body.replace('Хранилище: до 100 файлов и 100 МБ.','Хранилище: до 100 файлов и 100 МБ. Новые файлы могут появиться у посетителей через минуту или позже.').replace('Скачайте тексты, работы и историю одним файлом.','Скачайте тексты, работы, файлы и историю одним файлом. Полная копия доступна для 40 файлов суммарно до 32 МБ.');
 writeFileSync(join(dir,'public',name),body);
}
cpSync(join(source,'public/_headers'),join(dir,'public/_headers'));
const key=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(key).digest('hex');
const sql=s=>"'"+String(s).replaceAll("'","''")+"'";
const contentJson=JSON.stringify(seed.content);
const statements=[
 `INSERT INTO pf_settings(id,key_hash,asset_count,asset_bytes) VALUES(1,${sql(hash)},${seed.assets.length},${seed.assets.reduce((n,a)=>n+a.bytes.length,0)});`,
 `INSERT INTO pf_content(id,version,json) VALUES(1,${seed.version},${sql(contentJson)});`
];
for(const asset of seed.assets){writeFileSync(join(dir,'seed/assets',asset.id),asset.bytes,{mode:0o600});statements.push(`INSERT INTO pf_assets(id,type,size,created) VALUES(${sql(asset.id)},${sql(asset.type)},${asset.bytes.length},${Date.now()});`)}
for(const h of seed.history)statements.push(`INSERT INTO pf_history(event,created,version,json) VALUES(${sql(h.event)},${Number(h.created)},${h.version===null?'NULL':Number(h.version)},${h.json===null?'NULL':sql(h.json)});`);
writeFileSync(join(dir,'seed/seed.sql'),statements.join('\n')+'\n',{mode:0o600});
writeFileSync(join(dir,'seed/assets.json'),JSON.stringify(seed.assets.map(a=>({id:a.id,type:a.type})),null,2)+'\n',{mode:0o600});
writeFileSync(join(dir,'install-settings.json'),JSON.stringify(names,null,2)+'\n',{mode:0o600});
writeFileSync(join(dir,'INSTALL-KEY.txt'),key+'\n',{mode:0o600});
if(existsSync(resolve('artifacts/instructions/portfolio-cloudflare-free-guide.pdf')))cpSync(resolve('artifacts/instructions/portfolio-cloudflare-free-guide.pdf'),join(dir,'ИНСТРУКЦИЯ-CLOUDFLARE.pdf'));
const archive=join(dir,'portfolio-cloudflare.zip');
execFileSync('zip',['-q','-r','-9',archive,'.','-x','portfolio-cloudflare.zip'],{cwd:dir});chmodSync(archive,0o600);
console.log(JSON.stringify({archive,directory:dir,...names,version:seed.version,assets:seed.assets.length}));
