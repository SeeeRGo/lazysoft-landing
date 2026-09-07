import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
const origin='https://lazysoft-request-demos-20260907.storage.yandexcloud.net';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Vary':'Origin'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
export const endpoint=httpAction(async(ctx,req)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method==='GET')return reply(await ctx.runQuery(internal.portfolio.read,{}));
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')??'';
 const expected=process.env.PORTFOLIO_03212396_ADMIN_HASH;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 if(!expected||token.length<40||hash!==expected)return reply({error:'Неверный ключ доступа'},401);
 try{
  const op=new URL(req.url).searchParams.get('op');
  if(op==='login')return reply({ok:true});
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
   try{await ctx.runMutation(internal.portfolio.registerAsset,{storageId,type,size})}catch(e){await ctx.storage.delete(storageId);throw e}
   return reply({storageId,url:await ctx.storage.getUrl(storageId)});
  }
  if(op==='save'){
   const raw=await req.text();if(raw.length>150000)return reply({error:'Слишком большой запрос'},413);
   const body=JSON.parse(raw);return reply({version:await ctx.runMutation(internal.portfolio.save,body)});
  }
  return reply({error:'Неизвестное действие'},400);
 }catch{return reply({error:'Не удалось сохранить. Проверьте поля, лимиты и актуальность страницы.'},400)}
});
