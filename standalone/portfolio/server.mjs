import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {mkdirSync,chmodSync,writeFileSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const TTL=15*60_000,MAX_FILE=8*1024*1024;
const hash=s=>createHash('sha256').update(s).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const headers={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
export function openDatabase(directory){
 mkdirSync(directory,{recursive:true,mode:0o700});
 const db=new DatabaseSync(join(directory,'portfolio.sqlite'),{timeout:5000});
 chmodSync(join(directory,'portfolio.sqlite'),0o600);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),key_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS content(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,json TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,type TEXT NOT NULL,bytes BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS limits(name TEXT PRIMARY KEY,tokens REAL NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY,event TEXT NOT NULL,created INTEGER NOT NULL,version INTEGER UNIQUE,json TEXT);
 CREATE INDEX IF NOT EXISTS history_created ON history(created);`);
 return db;
}
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(e){db.exec('ROLLBACK');throw e}}
export function initializeKey(db,directory,provided){
 return transaction(db,()=>{
 if(db.prepare('SELECT id FROM settings').get())return;
 const key=provided||random();if(!/^[A-Za-z0-9_-]{43}$/.test(key))fail('Некорректный начальный ключ');
 const file=join(directory,'initial-admin-key.txt');
 if(!provided)writeFileSync(file,key+'\n',{mode:0o600,flag:'wx'});
 db.prepare('INSERT INTO settings VALUES(1,?)').run(hash(key));
 if(!provided)console.log('Первый ключ администратора сохранён в '+file+'. Передайте его приватно.');
 });
}
function event(db,text,version=null,content=null){db.prepare('INSERT INTO history(event,created,version,json) VALUES(?,?,?,?)').run(text,Date.now(),version,content?JSON.stringify(content):null)}
function limit(db,name,capacity){
 const allowed=transaction(db,()=>{
  const now=Date.now(),old=db.prepare('SELECT * FROM limits WHERE name=?').get(name);
  const tokens=old?Math.min(capacity,old.tokens+Math.max(0,now-old.updated)*capacity/60000):capacity;
  db.prepare('INSERT INTO limits VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET tokens=excluded.tokens,updated=excluded.updated').run(name,Math.max(0,tokens-(tokens>=1?1:0)),now);
  return tokens>=1?0:Math.max(1,Math.ceil((1-tokens)*60/capacity));
 });
 if(allowed)throw Object.assign(new Error('Слишком много запросов. Повторите позже.'),{status:429,retryAfter:allowed});
}
function authorize(db,token){
 const session=token.length<=100?db.prepare('SELECT expires FROM sessions WHERE hash=?').get(hash(token)):null;
 if(!session||session.expires<=Date.now())fail('Сессия истекла или отозвана. Войдите снова.',401);
 return session;
}
function readContent(db){
 const row=db.prepare('SELECT * FROM content').get();if(!row)return null;
 const content=JSON.parse(row.json);
 return {version:row.version,content,works:content.works.map(w=>({...w,imageUrl:'/assets/'+w.image,documentUrl:w.document?'/assets/'+w.document:null}))};
}
export function validateContent(db,c){
 if(!c||typeof c!=='object'||Array.isArray(c))fail('Проверьте содержимое');
 for(const [key,max] of Object.entries({name:100,headline:160,about:3000,email:254,telegram:33,prices:3000}))if(typeof c[key]!=='string'||c[key].length>max)fail('Проверьте поле '+key);
 if(!c.name.trim()||!c.headline.trim())fail('Укажите имя и заголовок');
 if(c.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))fail('Проверьте почту');
 if(c.telegram&&!/^@?[A-Za-z0-9_]{5,32}$/.test(c.telegram))fail('Telegram: @username');
 if(!Array.isArray(c.works)||c.works.length>40)fail('Максимум 40 работ');
 const ids=new Set();
 for(const w of c.works){
  if(!w||typeof w.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(w.id)||ids.has(w.id)||!['covers','spreads','magazines','logos'].includes(w.category)||typeof w.title!=='string'||!w.title.trim()||w.title.length>150||typeof w.description!=='string'||w.description.length>2000)fail('Проверьте поля работы');
  ids.add(w.id);
  for(const [id,pdf] of [[w.image,false],[w.document,true]]){
   if(pdf&&id===undefined)continue;
   if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id))fail('Недопустимый файл');
   const asset=db.prepare('SELECT type FROM assets WHERE id=?').get(id);
   if(!asset||(pdf?asset.type!=='application/pdf':!asset.type.startsWith('image/')))fail('Файл не найден или имеет неверный тип');
  }
 }
 // Keep only supported data, never arbitrary client-supplied URLs or script fields.
 return {name:c.name,headline:c.headline,about:c.about,email:c.email,telegram:c.telegram,prices:c.prices,works:c.works.map(({id,category,title,description,image,document})=>({id,category,title,description,image,...(document?{document}:{})}))};
}
export function validFile(type,b){
 if(!b.length||b.length>MAX_FILE)return false;
 if(type==='image/png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(type==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
 if(type==='image/webp')return b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
 return type==='application/pdf'&&b.toString('ascii',0,5)==='%PDF-';
}
async function body(req,max){
 if(Number(req.headers['content-length'])>max)fail('Слишком большой запрос',413);
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)fail('Слишком большой запрос',413);chunks.push(chunk)}return Buffer.concat(chunks);
}
const PUBLIC_FILES=new Set(['index.html','covers.html','spreads.html','magazines.html','logos.html','admin.html','categories-v2.css','gallery-v2.js','admin-v1.css','admin-v1.js','content-v1.js']);
export function createApp({dataDir=join(ROOT,'data'),publicDir=join(ROOT,'public'),initialKey,publicOrigin=process.env.PUBLIC_ORIGIN}={}){
 if(publicOrigin&&new URL(publicOrigin).origin!==publicOrigin)throw Error('PUBLIC_ORIGIN должен содержать только протокол и домен, без пути');
 const db=openDatabase(dataDir);initializeKey(db,dataDir,initialKey);
 const json=(res,value,status=200,extra={})=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(value))};
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/health')return json(res,{ok:true});
  if(url.pathname==='/api/portfolio'){
   if(req.method==='GET'){limit(db,'read',120);return json(res,readContent(db))}
   if(req.method!=='POST')return json(res,{error:'Метод не поддерживается'},405);
   const origin=req.headers.origin,expected=publicOrigin||'http://'+req.headers.host;
   if(origin&&origin!==expected)fail('Запрос с другого сайта запрещён',403);
   const op=url.searchParams.get('op'),token=(req.headers.authorization||'').replace(/^Bearer /,'');
   if(op==='login'){
    limit(db,'login',5);
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!equal(hash(token),db.prepare('SELECT key_hash FROM settings').get().key_hash))fail('Неверный ключ доступа',401);
    const session=random(),expiresAt=Date.now()+TTL;
    transaction(db,()=>{db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(session),expiresAt);event(db,'Вход в админку')});
    return json(res,{token:session,expiresAt});
   }
   try{authorize(db,token)}catch(e){limit(db,'invalid',30);throw e}
   limit(db,op==='upload'?'upload':'admin',op==='upload'?10:60);
   if(op==='logout'||op==='revoke'){transaction(db,()=>{authorize(db,token);db.prepare('DELETE FROM sessions').run();event(db,'Все сессии отозваны')});return json(res,{ok:true})}
   if(op==='rotate'){
    const {newKey}=JSON.parse((await body(req,1000)).toString());if(typeof newKey!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(newKey))fail('Неверный формат ключа');
    transaction(db,()=>{authorize(db,token);db.prepare('UPDATE settings SET key_hash=?').run(hash(newKey));db.prepare('DELETE FROM sessions').run();event(db,'Ключ заменён, все сессии отозваны')});return json(res,{ok:true});
   }
   if(op==='history')return json(res,db.prepare('SELECT event,created AS createdAt,version FROM history ORDER BY id DESC LIMIT 50').all().map(r=>({...r,...(r.version===null?{version:undefined}:{})})));
   if(op==='revision'){const {version}=JSON.parse((await body(req,1000)).toString());authorize(db,token);if(!Number.isSafeInteger(version))fail('Неверная версия');const row=db.prepare('SELECT json FROM history WHERE version=?').get(version);return json(res,row?.json?JSON.parse(row.json):null)}
   if(op==='upload'){
    const type=req.headers['content-type'];if(!['image/png','image/jpeg','image/webp','application/pdf'].includes(type))fail('Разрешены JPG, PNG, WebP и PDF');
    const bytes=await body(req,MAX_FILE);if(!validFile(type,bytes))fail('Формат файла не соответствует содержимому');
    const id=randomBytes(16).toString('hex');
    transaction(db,()=>{authorize(db,token);const q=db.prepare('SELECT count(*) AS count,coalesce(sum(length(bytes)),0) AS size FROM assets').get();if(q.count>=100||q.size+bytes.length>100*1024*1024)fail('Лимит: 100 файлов / 100 МБ');db.prepare('INSERT INTO assets VALUES(?,?,?)').run(id,type,bytes)});
    return json(res,{storageId:id,url:'/assets/'+id});
   }
   if(op==='save'){
    const payload=JSON.parse((await body(req,150000)).toString());
    const version=transaction(db,()=>{
     authorize(db,token);const c=validateContent(db,payload.content),row=db.prepare('SELECT * FROM content').get();
     if(!Number.isSafeInteger(payload.version)||payload.version!==(row?.version??0))fail('Версия изменилась в другой вкладке. Перезагрузите страницу.',409);
     if(row&&!db.prepare('SELECT id FROM history WHERE version=?').get(row.version))event(db,'Версия до включения истории',row.version,JSON.parse(row.json));
     const version=payload.version+1,previous=row?JSON.parse(row.json):{};
     const changed=Object.keys(c).filter(k=>JSON.stringify(c[k])!==JSON.stringify(previous[k]));
     db.prepare('INSERT INTO content VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,json=excluded.json').run(version,JSON.stringify(c));event(db,'Публикация: '+changed.join(', '),version,c);return version;
    });return json(res,{version});
   }
   fail('Неизвестное действие');
  }
  if(!['GET','HEAD'].includes(req.method))return json(res,{error:'Метод не поддерживается'},405);
  if(/^\/assets\/[A-Za-z0-9_-]{1,80}$/.test(url.pathname)){
   const asset=db.prepare('SELECT type,bytes FROM assets WHERE id=?').get(url.pathname.slice(8));if(!asset)fail('Файл не найден',404);
   res.writeHead(200,{...headers,'Content-Type':asset.type,'Content-Length':asset.bytes.length,'Cache-Control':'public,max-age=86400',...(asset.type==='application/pdf'?{'Content-Disposition':'attachment; filename="portfolio.pdf"'}:{})});return res.end(req.method==='HEAD'?undefined:Buffer.from(asset.bytes));
  }
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!PUBLIC_FILES.has(file))fail('Страница не найдена',404);
  const bytes=readFileSync(join(publicDir,file));const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)];
  res.writeHead(200,{...headers,'Content-Type':type,'Cache-Control':'no-cache','Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);
 }catch(e){if(!res.headersSent)json(res,{error:e.status?e.message:e instanceof SyntaxError?'Некорректный JSON':'Не удалось выполнить запрос'},e.status||(e instanceof SyntaxError?400:500),e.retryAfter?{'Retry-After':String(e.retryAfter)}:{});else res.end()}});
 server.requestTimeout=30_000;server.headersTimeout=15_000;server.maxHeadersCount=40;
 return {server,db,close:()=>new Promise((resolveClose,reject)=>{server.close(e=>{db.close();e?reject(e):resolveClose()});server.closeIdleConnections()})};
}
export function start(options={}){
 const app=createApp({dataDir:resolve(process.env.DATA_DIR||join(ROOT,'data')),...options});
 app.server.listen(Number(process.env.PORT||8080),process.env.HOST||'127.0.0.1',()=>console.log('Portfolio server started'));
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{app.close().then(()=>process.exit(0))});
 return app;
}
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url)))start();
