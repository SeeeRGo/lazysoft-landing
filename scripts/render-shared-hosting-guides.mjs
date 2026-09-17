import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const jobs=[
  ['docs/cloudflare-hostiman-comparison.html','artifacts/instructions/cloudflare-hostiman-comparison.pdf'],
  ['docs/portfolio-cloudflare-workers-guide.html','artifacts/archive/instructions/portfolio-cloudflare-workers-guide.pdf'],
  ['docs/portfolio-cloudflare-free-guide.html','artifacts/instructions/portfolio-cloudflare-free-guide.pdf'],
  ['docs/portfolio-spaceweb-free-guide.html','artifacts/archive/instructions/portfolio-spaceweb-free-guide.pdf'],
  ['docs/portfolio-hostiman-free-guide.html','artifacts/archive/instructions/portfolio-hostiman-free-guide.pdf'],
  ['docs/portfolio-hostiman-options-guide.html','artifacts/instructions/portfolio-hostiman-options-guide.pdf'],
  ['docs/portfolio-hostinger-guide.html','artifacts/archive/instructions/portfolio-hostinger-guide.pdf'],
];
// Optional HTML path limits regeneration to a single guide.
const requestedGuide=process.argv[2];
const selectedJobs=requestedGuide?jobs.filter(([html])=>html===requestedGuide):jobs;
if(!selectedJobs.length)throw Error('Unknown guide: '+requestedGuide);
const profile=mkdtempSync('/tmp/shared-hosting-pdf-');
const chrome=spawn('/usr/bin/chromium',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let ws;
try {
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
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Document evaluation failed');return r.result.value};
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia',{media:'print'});
  await send('Emulation.setDeviceMetricsOverride',{width:673,height:1017,deviceScaleFactor:1,mobile:false});
  mkdirSync('artifacts/instructions',{recursive:true});
  mkdirSync('artifacts/archive/instructions',{recursive:true});
  for(const [html,out] of selectedJobs){
    await send('Page.navigate',{url:pathToFileURL(resolve(html)).href});
    await new Promise(r=>setTimeout(r,350));
    await evaluate(`Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode())]).then(()=>true)`);
    const report=await evaluate(`(()=>[...document.querySelectorAll('.page')].map((p,i)=>{const foot=p.querySelector('.footer').getBoundingClientRect();const children=[...p.children].filter(x=>!x.classList.contains('footer'));const last=Math.max(...children.map(x=>x.getBoundingClientRect().bottom));return {page:i+1,remainingPx:Math.round(foot.top-last),overflow:p.scrollHeight>p.clientHeight+1}}))()`);
    console.log(html+'\n'+JSON.stringify(report,null,2));
    if(report.some(r=>r.remainingPx<4||r.overflow))throw Error(html+': page content overlaps footer or overflows');
    const pdf=await send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false,generateTaggedPDF:true,generateDocumentOutline:true});
    writeFileSync(out,Buffer.from(pdf.data,'base64'));
    console.log('PDF: '+out);
  }
} finally { ws?.close(); chrome.kill('SIGTERM'); }
