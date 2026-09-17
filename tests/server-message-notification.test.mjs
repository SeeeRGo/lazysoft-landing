import {test} from 'vitest';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

for (const telegramAccepts of [true,false]) {
 test(`Visitor message waits for Telegram ${telegramAccepts?'confirmation':'rejection'} before responding`,{timeout:15000},async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'lazysoft-notification-test-'));
  let notificationResponse,notificationBody;
  const mock=createServer(async(req,res)=>{
   let raw='';for await(const chunk of req)raw+=chunk;
   res.setHeader('Content-Type','application/json');
   if(req.url==='/telegram'){notificationBody=JSON.parse(raw);notificationResponse=res;return;}
   assert.equal(req.url,'/request-thread/message');
   assert.equal(JSON.parse(raw).text,'Проверочное сообщение без внешней отправки');
   res.end(JSON.stringify({ok:true,requestId:'#local-test'}));
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const backend=`http://127.0.0.1:${mock.address().port}`;
  const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
  const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const preload=join(temporary,'fetch.mjs');
  await writeFile(preload,`const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(input);if(url.hostname==='api.telegram.org')return original(${JSON.stringify(backend+'/telegram')},init);if(url.hostname==='127.0.0.1')return original(input,init);throw Error('External requests prohibited in test')};`);
  const app=spawn(process.execPath,['--import',preload,resolve(process.env.NOTIFICATION_TEST_SERVER||'server.mjs')],{env:{PATH:process.env.PATH,PORT:String(port),CONVEX_SITE_URL:backend,CONVEX_INGEST_SECRET:'local-test-secret',TELEGRAM_BOT_TOKEN:'local-test-token',TELEGRAM_CHAT_ID:'local-test-chat'},stdio:'ignore'});
  try{
   let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/healthz`)).ok){ready=true;break}}catch{}await delay(30)}assert.ok(ready);
   let completed=false;
   const responsePromise=fetch(`http://127.0.0.1:${port}/api/request-thread/message`,{method:'POST',headers:{'Content-Type':'application/json',Origin:`http://127.0.0.1:${port}`},body:JSON.stringify({accessToken:'a'.repeat(43),text:'Проверочное сообщение без внешней отправки'})}).then(r=>{completed=true;return r});
   for(let i=0;i<100&&!notificationResponse;i++)await delay(20);
   assert.ok(notificationResponse,'Telegram notification requested');
   assert.ok(notificationBody.text.includes('#local-test'));
   await delay(100);assert.equal(completed,false,'HTTP response must wait for Telegram to finish');
   notificationResponse.statusCode=telegramAccepts?200:403;
   notificationResponse.end(JSON.stringify({ok:telegramAccepts,description:telegramAccepts?'':'mock rejection'}));
   const response=await responsePromise;assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
  }finally{
   notificationResponse?.end();app.kill('SIGTERM');mock.closeAllConnections();await new Promise(r=>mock.close(r));await rm(temporary,{recursive:true,force:true});
  }
 });
}
