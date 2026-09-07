import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { issueSession, verifySession } from './portfolioSession';
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const origin='https://lazysoft-request-demos-20260907.storage.yandexcloud.net';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Vary':'Origin'};
const reply=(data:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers:{...headers,...extra}});
export const endpoint=httpAction(async(ctx,req)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 const op=new URL(req.url).searchParams.get('op');
 const throttle=async(kind:'read'|'login'|'invalid'|'admin'|'upload')=>{const r=await ctx.runMutation(internal.portfolioSecurity.limit,{kind});return r.ok?null:reply({error:'Слишком много запросов. Повторите позже.',retryAfter:Math.ceil(r.retryAfter/1000)},429,{'Retry-After':String(Math.max(1,Math.ceil(r.retryAfter/1000)))})};
 if(req.method==='GET'){const limited=await throttle('read');return limited??reply(await ctx.runQuery(internal.portfolio.read,{}))}
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
 if(op==='login'){
  const limited=await throttle('login');if(limited)return limited;
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return reply({error:'Неверный ключ доступа'},401);
  const epoch=await ctx.runMutation(internal.portfolioSecurity.login,{keyHash:await digest(token)});
  if(epoch===null)return reply({error:'Неверный ключ доступа'},401);
  return reply(await issueSession(epoch));
 }
 let session;
 try{if(token.length>2048)throw Error('Invalid token');session=await verifySession(token);if((await ctx.runQuery(internal.portfolioSecurity.state,{})).epoch!==session.epoch)throw Error('Revoked')}
 catch{const limited=await throttle('invalid');return limited??reply({error:'Сессия истекла или отозвана. Войдите снова.'},401)}
 const limited=await throttle(op==='upload'?'upload':'admin');if(limited)return limited;
 try{
  if(op==='logout'||op==='revoke'){await ctx.runMutation(internal.portfolioSecurity.revoke,session);return reply({ok:true})}
  if(op==='rotate'){
   const raw=await req.text();if(raw.length>1000)return reply({error:'Слишком большой запрос'},413);
   const {newKey}=JSON.parse(raw);if(typeof newKey!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(newKey))return reply({error:'Неверный формат нового ключа'},400);
   await ctx.runMutation(internal.portfolioSecurity.revoke,{...session,newKeyHash:await digest(newKey)});
   return reply({ok:true});
  }
  if(op==='history')return reply(await ctx.runQuery(internal.portfolioSecurity.history,session));
  if(op==='revision'){
   const raw=await req.text();if(raw.length>1000)return reply({error:'Слишком большой запрос'},413);
   const body=JSON.parse(raw);return reply(await ctx.runQuery(internal.portfolioSecurity.revision,{...session,version:body.version}));
  }
  if(op==='upload'){
   const type=req.headers.get('Content-Type')??'';
   if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(type))return reply({error:'Разрешены JPG, PNG, WebP и PDF'},400);
   const reader=req.body?.getReader();if(!reader)return reply({error:'Нет файла'},400);
   const chunks:Uint8Array[]=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();return reply({error:'Файл больше 8 МБ'},413)}chunks.push(value)}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
   const ascii=(a:number,b:number)=>new TextDecoder().decode(bytes.slice(a,b));
   const valid=type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/png'?bytes[0]===137&&ascii(1,4)==='PNG':type==='image/webp'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP':ascii(0,5)==='%PDF-';
   if(!valid)return reply({error:'Содержимое файла не соответствует формату'},400);
   const storageId=await ctx.storage.store(new Blob([bytes],{type}));
   try{await ctx.runMutation(internal.portfolio.registerAsset,{storageId,type,size,...session})}catch(e){await ctx.storage.delete(storageId);throw e}
   return reply({storageId,url:await ctx.storage.getUrl(storageId)});
  }
  if(op==='save'){
   const raw=await req.text();if(raw.length>150000)return reply({error:'Слишком большой запрос'},413);
   const body=JSON.parse(raw);return reply({version:await ctx.runMutation(internal.portfolio.save,{content:body.content,version:body.version,...session})});
  }
  return reply({error:'Неизвестное действие'},400);
 }catch{return reply({error:'Не удалось сохранить. Проверьте поля, лимиты и актуальность страницы.'},400)}
});
