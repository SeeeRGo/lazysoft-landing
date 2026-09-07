import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import {createHash} from 'node:crypto';
import schema from '../convex/schema';
import {internal} from '../convex/_generated/api';
import {issueSession,verifySession} from '../convex/portfolioSession';
const modules=import.meta.glob('../convex/**/*.ts');
const rootKey='a'.repeat(43),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const setup=()=>{const t=convexTest(schema,modules);rateLimiterTest.register(t);return t};
const content={name:'Первое имя',headline:'Портфолио',about:'',email:'',telegram:'',prices:'',works:[]};
beforeEach(()=>{vi.stubEnv('PORTFOLIO_SESSION_SECRET','s'.repeat(43));vi.stubEnv('PORTFOLIO_03212396_ADMIN_HASH',hash(rootKey))});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers()});
it('issues a 15-minute token, rejects tampering and expiry',async()=>{
 vi.useFakeTimers();const session=await issueSession(0);
 expect(session.expiresAt-Date.now()).toBeLessThanOrEqual(900000);
 expect((await verifySession(session.token)).epoch).toBe(0);
 await expect(verifySession('x'+session.token)).rejects.toThrow();
 vi.advanceTimersByTime(900001);await expect(verifySession(session.token)).rejects.toThrow();
});
it('requires a session, not the long-term key, for admin operations',async()=>{
 const t=setup();
 const call=(op:string,token:string)=>t.fetch('/portfolio-03212396?op='+op,{method:'POST',headers:{Authorization:'Bearer '+token},body:'{}'});
 expect((await call('history',rootKey)).status).toBe(401);
 const response=await call('login',rootKey);expect(response.status).toBe(200);const {token}=await response.json();
 expect((await call('history',token)).status).toBe(200);
 expect((await call('revoke',token)).status).toBe(200);
 expect((await call('history',token)).status).toBe(401);
});
it('rotation revokes existing sessions AND rejects the previous login key',async()=>{
 const t=setup(),s={epoch:0,expiresAt:Date.now()+900000};
 await t.mutation(internal.portfolioSecurity.revoke,{...s,newKeyHash:hash('b'.repeat(43))});
 expect(await t.mutation(internal.portfolioSecurity.login,{keyHash:hash(rootKey)})).toBeNull();
 expect(await t.mutation(internal.portfolioSecurity.login,{keyHash:hash('b'.repeat(43))})).toBe(1);
 await expect(t.mutation(internal.portfolio.save,{...s,content,version:0})).rejects.toThrow();
});
it('checks expiry inside writes, not just at the start of HTTP upload',async()=>{
 const t=setup();await expect(t.mutation(internal.portfolio.save,{content,version:0,epoch:0,expiresAt:Date.now()-1})).rejects.toThrow();
});
it('keeps earlier content immutable and does not expose history publicly',async()=>{
 const t=setup(),s={epoch:0,expiresAt:Date.now()+900000};
 await t.mutation(internal.portfolio.save,{...s,content,version:0});
 await t.mutation(internal.portfolio.save,{...s,content:{...content,name:'Второе имя'},version:1});
 expect((await t.query(internal.portfolioSecurity.revision,{...s,version:1}))?.name).toBe('Первое имя');
 expect(await t.query(internal.portfolioSecurity.history,s)).toHaveLength(2);
 const publicData=await(await t.fetch('/portfolio-03212396')).json();expect(publicData.content.name).toBe('Второе имя');expect(publicData.history).toBeUndefined();
});
it('limits login attempts across requests and sends Retry-After',async()=>{
 const t=setup();let response;
 for(let i=0;i<6;i++)response=await t.fetch('/portfolio-03212396?op=login',{method:'POST',headers:{Authorization:'Bearer wrong'},body:'{}'});
 expect(response?.status).toBe(429);expect(Number(response?.headers.get('Retry-After'))).toBeGreaterThan(0);
});
