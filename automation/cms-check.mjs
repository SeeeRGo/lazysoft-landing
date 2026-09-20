import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
export async function checkCms(site,{screenshots,forbidFallback=false}={}){
 const directory=resolve(site),profile=await mkdtemp(join(tmpdir(),'lazysoft-cms-browser-'));
 const schema=JSON.parse(await readFile(join(directory,'cms-schema.json'),'utf8'));
 const png=join(profile,'upload.png');await writeFile(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ5kAAAAASUVORK5CYII=','base64'));
 const server=createServer(async(req,res)=>{try{const path=resolve(directory,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!path.startsWith(directory+sep))throw Error();const data=await readFile(path);res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'})[extname(path)]||'application/octet-stream');res.end(data)}catch{res.writeHead(404);res.end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const chrome=spawn('/usr/bin/chromium',['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe'],env:{PATH:process.env.PATH,LANG:'C.UTF-8',HOME:profile,TMPDIR:profile}});
 let chromeExit,chromeError='';
 chrome.once('exit',code=>{chromeExit=code});
 chrome.stderr.on('data',chunk=>{chromeError=(chromeError+chunk.toString()).slice(-2000)});
 let ws;
 try{
 let port;for(let i=0;i<300;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break}catch{}if(chromeExit!==undefined)break;await new Promise(r=>setTimeout(r,100))}if(!port){const reason=chromeExit===undefined?'startup timeout':`exit ${chromeExit}`;const detail=chromeError.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).at(-1)?.replace(/[^A-Za-z0-9 .:_/-]/g,'').slice(0,160);throw Error(`Chromium unavailable: ${reason}${detail?`: ${detail}`:''}`)}
 const pages=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());ws=new WebSocket(pages[0].webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map(),errors=[];
 const send=(method,params={})=>new Promise((resolve,reject)=>{const call=++id,timer=setTimeout(()=>{pending.delete(call);reject(Error('CMS browser command timed out: '+method))},10000);pending.set(call,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id:call,method,params}))});
 ws.addEventListener('close',()=>{for(const {reject} of pending.values())reject(Error('CMS browser connection closed'));pending.clear()});
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Fetch.requestPaused'){const u=m.params.request.url,allowed=u.startsWith(origin+'/')||u.startsWith('data:image/');void send(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(allowed?{}:{errorReason:'BlockedByClient'})});if(!allowed)errors.push('External request blocked');}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Network.responseReceived'&&m.params.response.status>=400&&!m.params.response.url.endsWith('favicon.ico'))errors.push('HTTP '+m.params.response.status);if(!m.id)return;const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(m.error):p.resolve(m.result)});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('CMS browser script failed');return r.result.value};
 const until=async(expression,label='condition',attempts=100)=>{for(let i=0;i<attempts;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error('CMS browser condition timed out: '+label)};
 const navigate=async path=>{await send('Page.navigate',{url:origin+'/'+path});await until(`location.pathname===${JSON.stringify('/'+path)}&&document.readyState==='complete'`)};
 const navigateAdminCollection=async key=>{for(let attempt=0;attempt<2;attempt++){await navigate('admin.html');try{await until(`!!document.querySelector('[data-add-collection="${key}"]')&&!document.querySelector('#editor').hidden`,'admin collection '+key,150);return}catch(error){if(attempt===1){const detail=await evaluate(`(()=>{const status=document.querySelector('#status')?.textContent?.trim()||'no status';return status.slice(0,160)})()`);throw Error(error.message+`: ${detail}`)}}}};
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setBypassServiceWorker',{bypass:true});await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await navigate('index.html');
 const duplicateIds=await evaluate(`(()=>{const ids=Array.from(document.querySelectorAll('[id]'),e=>e.id);return [...new Set(ids.filter((value,index)=>ids.indexOf(value)!==index))]})()`);
 assert.deepEqual(duplicateIds,[],'Public page contains duplicate HTML ids');
 // App boot is async: rendered images may appear after readyState, and lazy
 // images inserted later never become eager from a one-shot pass. Settle in
 // rounds: force eager, scroll, wait for completion, repeat while the image
 // count keeps growing.
 for (let round = 0; round < 10; round += 1) {
  await evaluate(`(()=>{document.querySelectorAll('img').forEach(i=>{i.loading='eager'});window.scrollTo(0,document.body.scrollHeight)})()`);
  await until(`(()=>{const images=Array.from(document.images).filter(i=>/\\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(i.src));return images.length>=3&&images.every(i=>i.complete&&i.naturalWidth>0)})()`,'initial raster images');
  const seen = await evaluate(`document.images.length`);
  await new Promise(r=>setTimeout(r,400));
  if (await evaluate(`document.images.length`) === seen) break;
  if (round === 9) throw Error('CMS images keep changing without settling');
 }
 const visibleText=await evaluate(`document.body.innerText.replace(/\\s+/g,' ').trim().length`);
 assert(visibleText>=200,'Public page has too little rendered text');
 const misplacedFallbackCards=await evaluate(`Array.from(document.querySelectorAll('.lazysoft-cms-fallback-card')).filter(card=>!card.parentElement?.classList.contains('lazysoft-cms-fallback-grid')).length`);
 assert.equal(misplacedFallbackCards,0,'CMS fallback cards escaped their responsive grid');
 if(forbidFallback)assert.equal(await evaluate(`document.querySelectorAll('[data-lazysoft-cms-fallback]').length`),0,'CMS fallback duplicated content already rendered by the generated app');
 const hiddenContent=await evaluate(`Array.from(document.querySelectorAll('main h1,main h2,main h3,main p,main img')).filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&(s.visibility==='hidden'||Number(s.opacity)<0.1)}).length`);
 assert.equal(hiddenContent,0,'Public content remains hidden after rendering');
 const initialImages=await evaluate(`Array.from(document.images).filter(i=>!i.src.startsWith('data:')).map(i=>({src:new URL(i.src,location.href).pathname,width:i.naturalWidth,height:i.naturalHeight}))`);
 const rasterImages=initialImages.filter(i=>/\.(?:jpe?g|png|webp)$/i.test(i.src));
 assert(rasterImages.length>=3,'At least three generated raster images are required');
 assert(new Set(rasterImages.map(i=>i.src)).size>=3,'At least three distinct generated raster images are required');
 assert(rasterImages.every(i=>i.width>=512&&i.height>=384),'Generated raster images are too small or failed to load');
 assert.equal(initialImages.length,rasterImages.length,'Illustrative SVG or unsupported initial images are not allowed');
 for(const c of schema.collections){
  await navigateAdminCollection(c.key);
  await evaluate(`document.querySelector('[data-add-collection="${c.key}"]').click()`);
  const marker='CMS_CHECK_'+c.key;
  const fields=c.fields;
  for(const f of fields){
   const selector=`[data-collection="${c.key}"] .item:last-child [data-field="${f.key}"]`;
   if(f.type==='image'){
    const root=await send('DOM.getDocument');const input=await send('DOM.querySelector',{nodeId:root.root.nodeId,selector:`[data-collection="${c.key}"] .item:last-child [data-upload="${f.key}"]`});
    await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[png]});await until(`document.querySelector(${JSON.stringify(selector)}).value.startsWith('data:image/')`,'admin image upload '+c.key+'.'+f.key);
   }else await evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});i.value=${JSON.stringify(f.type==='number'?'123':f.type==='url'?'https://example.org':marker)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  }
  await evaluate(`document.querySelector('#editor').requestSubmit()`);await until(`document.querySelector('#status').textContent.startsWith('Сохранено')`,'admin save '+c.key);
  await navigate(c.page||'index.html');
  try{await until(`document.documentElement.textContent.includes(${JSON.stringify(marker)})`,'public collection '+c.key)}catch{throw Error('CMS collection is not rendered: '+c.key)}
  await evaluate(`Array.from(document.images).find(i=>i.src.startsWith('data:image/'))?.scrollIntoView({block:'center'})`);
  try{await until(`Array.from(document.images).filter(i=>i.src.startsWith('data:image/')).some(i=>i.complete&&i.naturalWidth>0)`,'public uploaded image '+c.key)}catch{throw Error('CMS uploaded image is not rendered: '+c.key)}
 }
 if(screenshots)await mkdir(screenshots,{recursive:true});
 const screenshot=async(name)=>{if(!screenshots)return;const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(screenshots,name+'.png'),Buffer.from(shot.data,'base64'))};
 for(const width of [390,1440]){await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await navigate('index.html');await until(`document.readyState==='complete'`);await until(`(()=>{const image=document.querySelector('.hero img,[class*="hero"] img');return !image||image.getBoundingClientRect().height>=80})()`,'responsive hero image');assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Public layout overflows');const flushImages=await evaluate(`(()=>{const gutter=innerWidth<500?16:24;return Array.from(document.images).filter(image=>{const r=image.getBoundingClientRect();const hero=image.closest('header,[class*="hero"],[id*="hero"]');return !hero&&r.width>innerWidth*.72&&(r.left<gutter-1||innerWidth-r.right<gutter-1)}).map(image=>image.getAttribute('src')||image.alt||'image')})()`);assert.deepEqual(flushImages,[],'Ordinary content images must keep viewport gutters');assert(await evaluate(`Array.from(document.querySelectorAll('a')).some(a=>new URL(a.href,location.href).pathname.endsWith('/admin.html'))`),'Public demo admin link is missing');await new Promise(r=>setTimeout(r,500));await screenshot('site-'+width);await navigate('admin.html');await until(`!document.querySelector('#editor').hidden`);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Admin layout overflows');await screenshot('admin-'+width)}
 assert.deepEqual(errors,[]);return {collections:schema.collections.length,admin:true,images:true,widths:[390,1440]};
 }finally{
  ws?.close();chrome.kill('SIGTERM');server.closeAllConnections?.();
  await Promise.race([new Promise(r=>server.close(r)),new Promise(r=>setTimeout(r,2000))]);
  if(chromeExit===undefined)chrome.kill('SIGKILL');
  await rm(profile,{recursive:true,force:true}).catch(()=>{});
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkCms(process.argv[2])));
