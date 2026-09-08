import {backup} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {writeFileSync,existsSync,chmodSync} from 'node:fs';
import {openDatabase,transaction} from './server.mjs';
const dir=resolve(process.env.DATA_DIR||fileURLToPath(new URL('./data',import.meta.url)));
const db=openDatabase(dir);
try{
 if(process.argv[2]==='backup'){
  const target=resolve(process.argv[3]||join(dir,'backup-'+Date.now()+'.sqlite'));if(existsSync(target))throw Error('Файл уже существует');
  await backup(db,target);chmodSync(target,0o600);console.log('Резервная копия: '+target);
 }else if(process.argv[2]==='reset-key'){
  const key=randomBytes(32).toString('base64url'),file=join(dir,'recovery-key-'+Date.now()+'.txt');
  writeFileSync(file,key+'\n',{mode:0o600,flag:'wx'});
  transaction(db,()=>{db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash').run(createHash('sha256').update(key).digest('hex'));db.prepare('DELETE FROM sessions').run();db.prepare('INSERT INTO history(event,created) VALUES(?,?)').run('Ключ сброшен владельцем сервера',Date.now())});
  console.log('Новый ключ: '+file+'. Старый ключ и сессии отозваны.');
 }else throw Error('Используйте: node manage.mjs backup [файл] или reset-key');
}finally{db.close()}
