import {test,expect} from 'vitest';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';import {resolve} from 'node:path';
test('contact-required resumable submission survives a lost HTTP response and never waits for inline Telegram',{timeout:15000},async()=>{
 let row,posts=0;const mock=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const p=JSON.parse(body);if(req.url==='/request-automation'){expect(p).toMatchObject({operation:'action',contactMethod:'email',contact:'buyer@example.org',kind:'offer_purchase_requested'});expect(p.accessToken).toBeUndefined();expect(p.accessTokenHash).toBe(createHash('sha256').update('b'.repeat(43)).digest('hex'));res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));return;}expect(req.url).toBe('/mvp-request');posts++;
 if(!row)row=p;
 expect(p.accessTokenHash).toBe(createHash('sha256').update('b'.repeat(43)).digest('hex'));expect(p.submissionToken).toBeUndefined();expect(p.ownerNotificationText).toContain('request-admin/#');
 if(posts===1){res.destroy();return;}
 res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,created:false,requestId:row.requestId}));
 });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const app=spawn(process.execPath,[resolve(process.env.SUBMISSION_TEST_SERVER||'server.mjs')],{env:{PATH:process.env.PATH,PORT:String(port),CONVEX_SITE_URL:`http://127.0.0.1:${mock.address().port}`,CONVEX_INGEST_SECRET:'local-test-secret'},stdio:'ignore'});
 try{
 for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/healthz`)).ok)break}catch{}await delay(30)}
 const send=()=>fetch(`http://127.0.0.1:${port}/api/mvp-request`,{method:'POST',headers:{'content-type':'application/json',origin:`http://127.0.0.1:${port}`},body:JSON.stringify({requestType:'mvp',idea:'Сайт магазина инструментов с каталогом',contactMethod:'telegram',contact:'@test_example',submissionToken:'b'.repeat(43)})});
 expect((await send()).status).toBe(500);const response=await send();expect(response.status).toBe(200);const data=await response.json();expect(data).toMatchObject({stored:true,notificationQueued:true,accessToken:'b'.repeat(43),requestId:row.requestId});expect(posts).toBe(2);expect(row.contactMethod).toBe('telegram');expect(row.contact).toBe('@test_example');
 for(const body of [{requestType:'mvp',idea:'Сайт магазина инструментов с каталогом',contactMethod:'none',contact:'stale@example.org',submissionToken:'c'.repeat(43)},{requestType:'mvp',idea:'Сайт магазина инструментов с каталогом',contactMethod:'email',contact:'invalid',submissionToken:'d'.repeat(43)},{requestType:'crm',idea:'Нужна доработка CRM по заявкам',submissionToken:'e'.repeat(43)}]){const invalid=await fetch(`http://127.0.0.1:${port}/api/mvp-request`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});expect(invalid.status).toBe(400)}expect(posts).toBe(2);
 const purchase=await fetch(`http://127.0.0.1:${port}/api/request-automation`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'action',accessToken:'b'.repeat(43),kind:'offer_purchase_requested',demoId:'1',hosting:'cloudflare',purchase:'source',offerVariant:'standard',contactMethod:'email',contact:'buyer@example.org'})});expect(purchase.status).toBe(200);expect(await purchase.json()).toEqual({ok:true});
 }finally{app.kill('SIGTERM');mock.closeAllConnections();await new Promise(r=>mock.close(r))}
});
