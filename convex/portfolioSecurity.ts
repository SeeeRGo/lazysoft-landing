import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { components } from './_generated/api';
import { RateLimiter, MINUTE } from '@convex-dev/rate-limiter';
import { portfolioContent } from './portfolioModel';
const slug='03212396';
const limiter=new RateLimiter(components.rateLimiter,{
 read:{kind:'token bucket',rate:120,period:MINUTE,capacity:120},
 login:{kind:'token bucket',rate:5,period:MINUTE,capacity:5},
 invalid:{kind:'token bucket',rate:30,period:MINUTE,capacity:30},
 admin:{kind:'token bucket',rate:60,period:MINUTE,capacity:60},
 upload:{kind:'token bucket',rate:10,period:MINUTE,capacity:10},
});
export const limit=internalMutation({args:{kind:v.union(v.literal('read'),v.literal('login'),v.literal('invalid'),v.literal('admin'),v.literal('upload'))},returns:v.object({ok:v.boolean(),retryAfter:v.number()}),handler:async(ctx,{kind})=>{
 const r=await limiter.limit(ctx,kind,{key:slug});return {ok:r.ok,retryAfter:r.retryAfter??0};
}});
export async function accessState(ctx:QueryCtx|MutationCtx){
 const row=await ctx.db.query('portfolioAccess').withIndex('by_slug',q=>q.eq('slug',slug)).unique();
 return {epoch:row?.epoch??0,keyHash:row?.keyHash??process.env.PORTFOLIO_03212396_ADMIN_HASH??''};
}
export async function requireEpoch(ctx:QueryCtx|MutationCtx,epoch:number,expiresAt:number){
 if(Date.now()>=expiresAt||(await accessState(ctx)).epoch!==epoch)throw Error('Session expired or revoked');
}
export const state=internalQuery({args:{},returns:v.object({epoch:v.number(),keyHash:v.string()}),handler:accessState});
export const login=internalMutation({args:{keyHash:v.string()},returns:v.union(v.null(),v.number()),handler:async(ctx,{keyHash})=>{
 const state=await accessState(ctx);if(!state.keyHash||state.keyHash!==keyHash)return null;
 await ctx.db.insert('portfolioHistory',{slug,event:'Вход в админку',createdAt:Date.now()});return state.epoch;
}});
export const revoke=internalMutation({args:{epoch:v.number(),expiresAt:v.number(),newKeyHash:v.optional(v.string())},returns:v.null(),handler:async(ctx,args)=>{
 await requireEpoch(ctx,args.epoch,args.expiresAt);
 const state=await accessState(ctx);const row=await ctx.db.query('portfolioAccess').withIndex('by_slug',q=>q.eq('slug',slug)).unique();
 const value={slug,epoch:state.epoch+1,keyHash:args.newKeyHash??state.keyHash};
 if(row)await ctx.db.patch(row._id,value);else await ctx.db.insert('portfolioAccess',value);
 await ctx.db.insert('portfolioHistory',{slug,event:args.newKeyHash?'Ключ заменён, все сессии отозваны':'Все сессии отозваны',createdAt:Date.now()});return null;
}});
export const history=internalQuery({args:{epoch:v.number(),expiresAt:v.number()},returns:v.array(v.object({event:v.string(),createdAt:v.number(),version:v.optional(v.number())})),handler:async(ctx,args)=>{
 await requireEpoch(ctx,args.epoch,args.expiresAt);
 return (await ctx.db.query('portfolioHistory').withIndex('by_slug',q=>q.eq('slug',slug)).order('desc').take(50)).map(({event,createdAt,version})=>({event,createdAt,...(version!==undefined?{version}:{})}));
}});
export const revision=internalQuery({args:{epoch:v.number(),expiresAt:v.number(),version:v.number()},returns:v.union(v.null(),portfolioContent),handler:async(ctx,args)=>{
 await requireEpoch(ctx,args.epoch,args.expiresAt);
 return (await ctx.db.query('portfolioHistory').withIndex('by_slug_version',q=>q.eq('slug',slug).eq('version',args.version)).unique())?.content??null;
}});
