import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,chmodSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
const directory='/srv/portfolio/data/backups';
mkdirSync(directory,{recursive:true,mode:0o700});
const db=new DatabaseSync('/srv/portfolio/data/portfolio.sqlite',{readOnly:true});
const target=join(directory,'backup-'+Date.now()+'.sqlite');
try{await backup(db,target);chmodSync(target,0o600)}finally{db.close()}
// Retain 14 successful daily copies, never remove arbitrary user files.
const generated=readdirSync(directory).filter(f=>/^backup-\d{13}\.sqlite$/.test(f)).sort().reverse();
for(const old of generated.slice(14))unlinkSync(join(directory,old));
console.log('Daily backup complete; retaining up to 14 copies.');
