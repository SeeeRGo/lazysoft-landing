import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const profile=mkdtempSync('/tmp/kv-browser-');
const chrome=spawn('/usr/bin/chromium',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let ws;
try{
 let port;
 for(let i=0;i<100;i++){
  try{port=readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0];break}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!port)throw Error('Chromium did not start');
 const pages=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json());
 ws=new WebSocket(pages[0].webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Browser evaluation failed');return r.result.value};
 await send('Page.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:8791/admin.html'});
 await new Promise(r=>setTimeout(r,600));
 const key=readFileSync(process.argv[2]||'artifacts/1/INSTALL-KEY.txt','utf8').trim();
 await evaluate(`document.querySelector('#key').value=${JSON.stringify(key)};document.querySelector('#login').requestSubmit()`);
 for(let i=0;i<40;i++){
  if(await evaluate(`!document.querySelector('#editor').hidden`))break;
  await new Promise(r=>setTimeout(r,100));
 }
 if(!await evaluate(`!document.querySelector('#editor').hidden`))throw Error('Admin login failed');
 await evaluate(`document.querySelector('[name=about]').value+=' Проверка KV в браузере.';document.querySelector('[name=about]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#editor').requestSubmit()`);
 await new Promise(r=>setTimeout(r,500));
 if(!await evaluate(`fetch('/api/portfolio').then(r=>r.json()).then(d=>d.content.about.endsWith('Проверка KV в браузере.'))`))throw Error('Published text not visible to another request');
 mkdirSync('artifacts/visual-check',{recursive:true});
 for(const [name,width,height] of [['desktop',1366,900],['mobile',390,844]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
  await new Promise(r=>setTimeout(r,200));
  const report=await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,editor:!document.querySelector('#editor').hidden})`);
  if(report.scroll>report.width+1)throw Error('Admin overflow: '+JSON.stringify(report));
  const shot=await send('Page.captureScreenshot',{format:'png'});
  writeFileSync('artifacts/visual-check/cloudflare-kv-admin-'+name+'.png',Buffer.from(shot.data,'base64'));
  console.log('Admin',name,report);
 }
 const category=await evaluate(`fetch('/api/portfolio').then(r=>r.json()).then(d=>d.works[0].category)`);
 await send('Page.navigate',{url:'http://127.0.0.1:8791/'+category+'.html'});
 await new Promise(r=>setTimeout(r,500));
 await evaluate(`Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode().catch(()=>{})}))`);
 const publicReport=await evaluate(`({images:[...document.images].map(i=>({loaded:i.complete&&i.naturalWidth>0})),width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})`);
 if(publicReport.scroll>publicReport.width+1||!publicReport.images.length||publicReport.images.some(i=>!i.loaded))throw Error('Public gallery failed: '+JSON.stringify(publicReport));
 const shot=await send('Page.captureScreenshot',{format:'png'});
 writeFileSync('artifacts/visual-check/cloudflare-kv-gallery-mobile.png',Buffer.from(shot.data,'base64'));
 console.log('Public gallery',publicReport);
}finally{ws?.close();chrome.kill('SIGTERM')}
