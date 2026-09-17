import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const packageRoot=process.argv[2];
if(!packageRoot||!packageRoot.includes('/.local/'))throw Error('Pass an isolated .local test package directory');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ5kAAAAASUVORK5CYII=','base64');
for(const hosting of (process.argv[3]?[process.argv[3]]:['cloudflare','hostiman'])){
 const base='http://127.0.0.1:'+(hosting==='cloudflare'?8794:8795),endpoint=hosting==='cloudflare'?'/api/portfolio':'/api.php',origin=hosting==='cloudflare'?base:base.replace('http:','https:');
 const key=readFileSync(packageRoot+'/'+hosting+'/INSTALL-KEY.txt','utf8').trim();
 if(hosting==='hostiman'){
  const response=await fetch(base+'/install.php',{method:'POST',headers:{'X-Forwarded-Proto':'https'},body:new URLSearchParams({host:'lazysoft-cms-check-db',database:'cms',user:'root',password:'cms-test-only',key})});
  const html=await response.text();assert.equal(response.status,200,html);assert(html.includes('Сайт установлен'),html);
 }
 async function req(op,body,token,extra={}){const r=await fetch(base+endpoint+(op?'?op='+op:''),{method:op?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},...(op?{body:JSON.stringify(body||{})}:{})});return {status:r.status,data:await r.json()}}
 const first=await req();assert.equal(first.status,200);assert.equal(first.data.content.items.products.length,1);
 assert.equal((await req('save',{content:first.data.content,version:1})).status,401);
 assert.equal((await req('login',{},key,{Origin:'https://wrong.example'})).status,403);
 const login=await req('login',{},key);assert.equal(login.status,200);const token=login.data.token;
 const upload=await fetch(base+endpoint+'?op=upload',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'image/png'},body:png});assert.equal(upload.status,200);const asset=await upload.json();
 const img=await fetch(base+asset.url);assert.equal(img.status,200);assert.deepEqual(Buffer.from(await img.arrayBuffer()),png);
 const content={values:{heading:'Изменено на сервере'},items:{products:Array.from({length:65},(_,i)=>({id:'item-'+i,name:'Товар '+i,price:i,image:i===64?asset.url:''}))}};
 const results=await Promise.all([req('save',{version:1,content},token),req('save',{version:1,content},token)]);
 assert.equal(results.filter(r=>r.status===200).length,1,JSON.stringify(results));assert.equal(results.filter(r=>r.status===409).length,1);
 const visitor=await req();assert.equal(visitor.data.content.items.products.length,65);assert.equal(visitor.data.content.values.heading,'Изменено на сервере');assert.equal(visitor.data.content.items.products[64].image,asset.url);
 const empty={...content,items:{products:[]}};assert.equal((await req('save',{version:2,content:empty},token)).status,200);assert.equal((await req()).data.content.items.products.length,0);
 assert.equal((await req('logout',{},token)).status,200);assert.equal((await req('save',{version:3,content},token)).status,401);
 console.log(JSON.stringify({hosting,installed:true,items:65,image:true,otherVisitorSeesChanges:true,emptyCatalog:true,concurrentSaveProtected:true,logoutRevokesSession:true}));
}
