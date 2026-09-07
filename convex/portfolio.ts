import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { portfolioContent, portfolioWork } from './portfolioModel';
const slug='03212396';
export const read = internalQuery({args:{},returns:v.union(v.null(),v.object({ content:portfolioContent, version:v.number(), works:v.array(v.object({...portfolioWork.fields,imageUrl:v.string(),documentUrl:v.union(v.string(),v.null())})) })),handler:async ctx=>{
 const row=await ctx.db.query('portfolios').withIndex('by_slug',q=>q.eq('slug',slug)).unique();
 if(!row)return null;
 const works=await Promise.all(row.content.works.map(async w=>({...w,imageUrl:(await ctx.storage.getUrl(w.image))??'',documentUrl:w.document?await ctx.storage.getUrl(w.document):null})));
 return {content:row.content,version:row.version,works};
}});
export const registerAsset=internalMutation({args:{storageId:v.id('_storage'),type:v.string(),size:v.number()},returns:v.null(),handler:async(ctx,args)=>{
 const assets=await ctx.db.query('portfolioAssets').withIndex('by_slug',q=>q.eq('slug',slug)).take(101);
 if(assets.length>=100||assets.reduce((n,a)=>n+a.size,0)+args.size>100*1024*1024)throw new Error('Лимит хранилища: 100 файлов / 100 МБ');
 await ctx.db.insert('portfolioAssets',{slug,...args});return null;
}});
export const save=internalMutation({args:{content:portfolioContent,version:v.number()},returns:v.number(),handler:async(ctx,{content,version})=>{
 if(!content.name.trim()||content.name.length>100||!content.headline.trim()||content.headline.length>160||content.about.length>3000||content.prices.length>3000||content.email.length>254||content.telegram.length>64||content.works.length>40)throw new Error('Проверьте длину полей (максимум 40 работ)');
 if(content.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content.email))throw new Error('Проверьте почту');
 if(content.telegram&&!/^@?[a-zA-Z0-9_]{5,32}$/.test(content.telegram))throw new Error('Укажите Telegram в виде @username');
 const ids=new Set();
 for(const w of content.works){
  if(!w.id||w.id.length>64||ids.has(w.id)||!w.title.trim()||w.title.length>150||w.description.length>2000)throw new Error('Проверьте название и описание работы');ids.add(w.id);
  for(const [storageId,pdf] of [[w.image,false],[w.document,true]] as const){
   if(!storageId)continue;
   const a=await ctx.db.query('portfolioAssets').withIndex('by_storage',q=>q.eq('storageId',storageId)).unique();
   if(!a||a.slug!==slug||(pdf?a.type!=='application/pdf':!a.type.startsWith('image/')))throw new Error('Недопустимый файл работы');
  }
 }
 const row=await ctx.db.query('portfolios').withIndex('by_slug',q=>q.eq('slug',slug)).unique();
 if((row?.version??0)!==version)throw new Error('Данные изменились в другой вкладке. Перезагрузите страницу');
 if(row)await ctx.db.patch(row._id,{content,version:version+1});else await ctx.db.insert('portfolios',{slug,content,version:1});
 return version+1;
}});
