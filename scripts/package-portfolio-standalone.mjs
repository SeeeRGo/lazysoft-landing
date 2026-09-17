// Generate a handover artifact from a consistent SQLite snapshot.
// Explicit allowlist prevents copying root .env, cloud credentials or old admin keys.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,cpSync,mkdirSync,chmodSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const source=resolve('standalone/portfolio'),input=resolve(process.argv[2]||'');
if(!process.argv[2]||!existsSync(join(input,'portfolio.sqlite')))throw Error('Usage: node scripts/package-portfolio-standalone.mjs <export-directory/data>');
const target=mkdtempSync(resolve('.local/portfolio-handover-'));chmodSync(target,0o700);
const app=join(target,'portfolio');mkdirSync(app,{mode:0o700});
for(const name of ['public','webroot','package.json','server.mjs','sqlite-compat.mjs','manage.mjs','passenger.cjs','hosting.example.json','beget.htaccess.example','check-hosting.mjs','README.md','Dockerfile','compose.yaml','.dockerignore','test.mjs'])cpSync(join(source,name),join(app,name),{recursive:true});
mkdirSync(join(app,'data'),{mode:0o700});
const db=new DatabaseSync(join(input,'portfolio.sqlite'),{readOnly:true});
try{await backup(db,join(app,'data/portfolio.sqlite'))}finally{db.close()}
const clean=new DatabaseSync(join(app,'data/portfolio.sqlite'));
try{clean.exec('DELETE FROM settings; DELETE FROM sessions; DELETE FROM limits; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;')}finally{clean.close()}
chmodSync(join(app,'data/portfolio.sqlite'),0o600);
const archive=join(target,'portfolio.tar.gz');execFileSync('tar',['-czf',archive,'-C',target,'portfolio']);chmodSync(archive,0o600);
console.log('Private handover archive: '+archive+' (no existing admin key or cloud credentials).');
