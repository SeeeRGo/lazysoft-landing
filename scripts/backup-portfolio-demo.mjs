// Read-only retrieval of the latest private backup from this demo's dedicated VM.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const args=['-i','.local/portfolio-demo-deploy-key','-o','UserKnownHostsFile=.local/portfolio-demo-known-hosts','-o','StrictHostKeyChecking=yes','yc-user@46.21.247.189'];
const names=execFileSync('ssh',[...args,'sudo find /srv/portfolio/data/backups -maxdepth 1 -type f -printf "%f\\n"'],{encoding:'utf8',timeout:30000}).trim().split('\n').filter(n=>/^backup-\d{13}\.sqlite$/.test(n)).sort();
if(!names.length)throw Error('No successful daily backup found');
const bytes=execFileSync('ssh',[...args,'sudo cat /srv/portfolio/data/backups/'+names.at(-1)],{maxBuffer:200*1024*1024,timeout:60000});
const target=mkdtempSync(resolve('.local/portfolio-demo-snapshot-'));chmodSync(target,0o700);
mkdirSync(join(target,'data'),{mode:0o700});
const file=join(target,'data/portfolio.sqlite');writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
const db=new DatabaseSync(file,{readOnly:true});
try{
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Backup integrity check failed');
 console.log(JSON.stringify({directory:target,version:db.prepare('SELECT version FROM content').get()?.version,assets:db.prepare('SELECT count(*) AS n FROM assets').get().n,bytes:bytes.length}));
}finally{db.close()}
