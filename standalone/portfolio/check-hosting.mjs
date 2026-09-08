// Run inside the hosting's runtime container, with the same Node binary as Passenger.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,rmSync,mkdirSync,statSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const [major,minor]=process.versions.node.split('.').map(Number);
if(major!==24||minor<12)throw Error('Required: Node 24.12+ (24.x), not the hosting default Node 8/18/20');
const data=join(root,'data');mkdirSync(data,{recursive:true,mode:0o700});
if((statSync(data).mode&0o077)!==0)throw Error('Private data directory must have mode 700');
const tmp=mkdtempSync(join(data,'preflight-'));
try{
 const db=new DatabaseSync(join(tmp,'test.sqlite'),{timeout:5000});
 try{
  if(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode!=='wal')throw Error('WAL is unavailable');
  db.exec('CREATE TABLE check_storage(value TEXT); INSERT INTO check_storage VALUES (\'ok\')');
  await backup(db,join(tmp,'backup.sqlite'));
  const restored=new DatabaseSync(join(tmp,'backup.sqlite'));
  try{if(restored.prepare('SELECT value FROM check_storage').get().value!=='ok')throw Error('Backup verification failed')}finally{restored.close()}
 }finally{db.close()}
 const c=JSON.parse(readFileSync(join(root,'hosting.json'),'utf8'));
 if(new URL(c.publicOrigin).origin!==c.publicOrigin||!c.publicOrigin.startsWith('https://'))throw Error('Check HTTPS publicOrigin in hosting.json');
 console.log('PASS: Node, SQLite WAL, disk writes, consistent backup, HTTPS origin.');
 console.log('Still verify with hosting support: persistent local filesystem with SQLite locking; Passenger and private app directory access.');
}finally{rmSync(tmp,{recursive:true,force:true})}
