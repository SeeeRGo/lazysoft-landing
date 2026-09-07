import {afterEach,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {internal} from '../convex/_generated/api';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
const session=()=>({epoch:0,expiresAt:Date.now()+900000});
const modules=import.meta.glob('../convex/**/*.ts');
afterEach(()=>vi.unstubAllEnvs());
const content={name:'Автор',headline:'Мои работы',about:'Описание',email:'',telegram:'',prices:'',works:[]};
it('does not permit anonymous publishing or uploads',async()=>{
 const t=convexTest(schema,modules);rateLimiterTest.register(t);
 for(const op of ['save','upload','login']){
  const r=await t.fetch('/portfolio-03212396?op='+op,{method:'POST',body:'{}'});expect(r.status).toBe(401);
 }
});
it('publishes content and rejects stale updates',async()=>{
 const t=convexTest(schema,modules);rateLimiterTest.register(t);
 expect(await t.query(internal.portfolio.read,{})).toBeNull();
 expect(await t.mutation(internal.portfolio.save,{...session(),content,version:0})).toBe(1);
 expect((await t.query(internal.portfolio.read,{}))?.content.name).toBe('Автор');
 await expect(t.mutation(internal.portfolio.save,{...session(),content,version:0})).rejects.toThrow();
});
it('rejects unregistered files and invalid Telegram links',async()=>{
 const t=convexTest(schema,modules);rateLimiterTest.register(t);
 const image=await t.run(ctx=>ctx.storage.store(new Blob(['image'])));
 await expect(t.mutation(internal.portfolio.save,{...session(),version:0,content:{...content,works:[{id:'1',category:'covers',title:'Работа',description:'',image}]}})).rejects.toThrow();
 await expect(t.mutation(internal.portfolio.save,{...session(),version:0,content:{...content,telegram:'javascript:alert(1)'}})).rejects.toThrow();
});
it('serves only registered portfolio images with the saved works',async()=>{
 const t=convexTest(schema,modules);rateLimiterTest.register(t);
 const image=await t.run(ctx=>ctx.storage.store(new Blob(['image'])));
 await t.mutation(internal.portfolio.registerAsset,{...session(),storageId:image,type:'image/png',size:5});
 await t.mutation(internal.portfolio.save,{...session(),version:0,content:{...content,works:[{id:'1',category:'covers',title:'Работа',description:'',image}]}});
 const data=await t.query(internal.portfolio.read,{});
 expect(data?.works[0].imageUrl).toMatch(/^https?:/);
});
