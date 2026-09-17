import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,chmodSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {randomBytes,createHash} from 'node:crypto';
if(!process.execArgv.includes('--experimental-sqlite')){
 const r=spawnSync(process.execPath,['--experimental-sqlite',fileURLToPath(import.meta.url),...process.argv.slice(2)],{stdio:'inherit'});process.exit(r.status??1);
}
const root=fileURLToPath(new URL('.',import.meta.url)),op=process.argv[2];
try{
 if(op==='restart'){mkdirSync(join(root,'tmp'),{recursive:true});writeFileSync(join(root,'tmp/restart.txt'),'');console.log('Перезапуск запрошен. Обновите сайт в браузере.');}
 else if(op==='backup'){
  const {openDatabase}=await import('./server.mjs'),{backup}=await import('./sqlite-compat.mjs');
  const dir=join(root,'data/backups');mkdirSync(dir,{recursive:true,mode:0o700});const target=join(dir,'backup-'+Date.now()+'.sqlite');
  const db=openDatabase(join(root,'data'));try{await backup(db,target);chmodSync(target,0o600)}finally{db.close()}
  console.log('Копия: '+target+'\nСкачайте файл через файловый менеджер и храните приватно.');
 }else if(op==='reset-key'){
  const ui=createInterface({input:process.stdin,output:process.stdout});let answer;try{answer=await ui.question('Старый ключ и все сессии перестанут работать. Для продолжения введите СМЕНИТЬ: ')}finally{ui.close()}
  if(answer.trim()!=='СМЕНИТЬ')throw Error('Отменено. Ключ не изменён.');
  const {openDatabase,transaction}=await import('./server.mjs');
  const key=randomBytes(32).toString('base64url'),name=join(root,'ADMIN-KEY-'+Date.now()+'.txt');
  writeFileSync(name,key+'\n',{mode:0o600,flag:'wx'});
  const db=openDatabase(join(root,'data'));
  try{transaction(db,()=>{db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash').run(createHash('sha256').update(key).digest('hex'));db.exec('DELETE FROM sessions');db.prepare('INSERT INTO history(event,created) VALUES(?,?)').run('Ключ восстановлен владельцем хостинга',Date.now())})}finally{db.close()}
  console.log('Новый ключ в файле '+name+'. Используйте его вместо прежнего.');
 }else if(op==='check'){
  const c=JSON.parse(readFileSync(join(root,'hosting.json'),'utf8'));
  for(const path of ['/health','/admin.html','/api/portfolio','/data/portfolio.sqlite','/ADMIN-KEY.txt','/hosting.json']){
   const r=await fetch(c.publicOrigin+path,{redirect:'manual',signal:AbortSignal.timeout(15000)});await r.body?.cancel();
   const expected=path.startsWith('/data/')||path==='/ADMIN-KEY.txt'||path==='/hosting.json'?404:200;
   console.log((r.status===expected?'OK':'ПРОВЕРИТЬ')+' '+path+' → '+r.status);
   if(r.status!==expected)process.exitCode=1;
  }
 }else throw Error('Команды: restart, backup, reset-key или check.');
}catch(e){console.error('Остановлено: '+e.message);process.exitCode=1}
