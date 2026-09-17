// Loopback-only browser check; CDP supplies the configured HTTPS Origin for the HTTP test server.
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const [site,port]=process.argv.slice(2),base='http://127.0.0.1:'+port;
const profile=mkdtempSync('/tmp/portfolio-sprint-browser-');
const chrome=spawn('/usr/bin/chromium',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let ws;
try {
 let debug;
 for(let i=0;i<80;i++){try{debug=readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0];break}catch{}await new Promise(r=>setTimeout(r,100))}
 if(!debug)throw Error('Chromium did not start');
 const pages=await fetch('http://127.0.0.1:'+debug+'/json').then(r=>r.json());
 ws=new WebSocket(pages[0].webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map(),errors=[];
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
 ws.addEventListener('message',async e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
  if(m.method==='Fetch.requestPaused'){
   const p=m.params,headers=Object.entries(p.request.headers).filter(([k])=>k.toLowerCase()!=='origin').map(([name,value])=>({name,value}));headers.push({name:'Origin',value:'https://test.example'});
   await send('Fetch.continueRequest',{requestId:p.requestId,headers});
  }
 });
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Evaluation failed');return r.result.value};
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:base+'/api.php*',requestStage:'Request'}]});
 for(const width of [1366,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
  for(const page of ['index','covers','spreads','magazines','logos','admin']){
   await send('Page.navigate',{url:base+'/'+page+'.html'});await new Promise(r=>setTimeout(r,400));
   if(page==='admin'){
    const key=readFileSync(site+'/INSTALL-KEY.txt','utf8').trim();
    await evaluate(`document.querySelector('#key').value=${JSON.stringify(key)};document.querySelector('#login').requestSubmit()`);
    await new Promise(r=>setTimeout(r,400));
    assert.ok(await evaluate(`document.querySelector('#login').hidden&&!document.querySelector('#editor').hidden`));
   }else assert.ok(await evaluate(`document.querySelector('.demo-notice').textContent.startsWith('Портфолио · ')`));
   assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth && [...document.images].every(i=>!i.complete||i.naturalWidth>0)`));
   if(page==='index'||page==='admin'){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(resolve(site,'../'+page+'-'+width+'.png'),Buffer.from(shot.data,'base64'))}
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS: 12 browser views, 390/1366px, migrated images, admin login, no horizontal overflow or JS exceptions.');
} finally {ws?.close();chrome.kill('SIGTERM')}
