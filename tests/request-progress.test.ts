import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.ts');
const input={requestId:'#test-progress',idea:'Магазин инструментов с каталогом и корзиной',contactMethod:'telegram' as const,contact:'@test',requestType:'mvp' as const,receivedAt:Date.now(),accessTokenHash:'a'.repeat(64),adminTokenHash:'b'.repeat(64),source:{utmSource:'',utmCampaign:'',utmContent:'',utmTerm:'',referrer:''},ownerNotificationText:'Тестовая заявка — только локальная заглушка'};
beforeEach(()=>{vi.useFakeTimers();vi.stubEnv('REQUEST_AUTOMATION_ENABLED','true')});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals()});
it('deduplicates a lost response and concurrent retries by the pre-saved access token',async()=>{
 const t=convexTest(schema,modules);const results=await Promise.all([t.mutation(internal.requests.store,input),t.mutation(internal.requests.store,{...input,requestId:'#retry',adminTokenHash:'c'.repeat(64)})]);
 expect(new Set(results.map(r=>r.requestId)).size).toBe(1);
 expect(results.filter(r=>r.created)).toHaveLength(1);
 expect(await t.run(ctx=>ctx.db.query('mvpRequests').take(10))).toHaveLength(1);
 expect(await t.run(ctx=>ctx.db.query('requestJobs').take(10))).toHaveLength(1);
 const events=await t.run(ctx=>ctx.db.query('requestEvents').take(10));expect(events).toHaveLength(1);expect(events[0].kind).toBe('request_received');
});
it('reports real stages, heartbeats and one start notification even after reclaim',async()=>{
 const t=convexTest(schema,modules);await t.mutation(internal.requests.store,input);
 expect((await t.query(internal.automation.summary,{accessTokenHash:input.accessTokenHash}))?.progress?.stage).toBe('queued');
 const job=await t.mutation(internal.automation.claim,{protocol:2,leaseToken:'d'.repeat(40)});expect(job).toBeTruthy();
 const lease={jobId:job!.jobId,leaseToken:job!.leaseToken};
 let summary=await t.query(internal.automation.summary,{accessTokenHash:input.accessTokenHash});expect(summary?.progress).toMatchObject({stage:'designing',startedAt:expect.any(Number),heartbeatAt:expect.any(Number)});
 expect(await t.mutation(internal.automation.heartbeat,{...lease,stage:'checking'})).toBe(true);
 expect((await t.query(internal.automation.summary,{accessTokenHash:input.accessTokenHash}))?.progress?.stage).toBe('checking');
 expect(await t.mutation(internal.automation.heartbeat,{...lease,leaseToken:'x'.repeat(40),stage:'publishing'})).toBe(false);
 await t.run(ctx=>ctx.db.patch(job!.jobId,{leaseUntil:Date.now()-1}));
 await t.mutation(internal.automation.claim,{protocol:2,leaseToken:'e'.repeat(40)});
 const reclaimed=await t.run(ctx=>ctx.db.query('requestJobAttempts').withIndex('by_job_id',q=>q.eq('jobId',job!.jobId)).take(10));
 expect(reclaimed.map(({attempt,stage,error,failedAt})=>({attempt,stage,error,failedAt}))).toEqual([{attempt:1,stage:'checking',error:'Lease expired before worker reported an error',failedAt:expect.any(Number)}]);
 const events=await t.run(ctx=>ctx.db.query('requestEvents').take(10));expect(events.filter(e=>e.kind==='generation_started')).toHaveLength(1);
});
it('keeps bot notifications owner-only, including previously queued client deliveries',async()=>{
 const t=convexTest(schema,modules);await t.mutation(internal.requests.store,input);
 await t.run(async ctx=>{const r=await ctx.db.query('mvpRequests').first();await ctx.db.patch(r!._id,{telegramChatId:'123456'});});
 const job=await t.mutation(internal.automation.claim,{protocol:2,leaseToken:'d'.repeat(40)});
 expect(await t.mutation(internal.deliveries.bindMessenger,{accessTokenHash:input.accessTokenHash,channel:'telegram',recipientId:'123456'})).toBe(false);
 expect(await t.run(ctx=>ctx.db.query('requestDeliveries').take(10))).toHaveLength(0);
 vi.stubEnv('TELEGRAM_BOT_USERNAME','old_bot');
 const summary=await t.query(internal.automation.summary,{accessTokenHash:input.accessTokenHash});
 expect(summary).not.toHaveProperty('telegramBotUsername');
 const deliveryId=await t.run(ctx=>ctx.db.insert('requestDeliveries',{requestId:input.requestId,jobId:job!.jobId,kind:'started',status:'pending',attempts:0}));
 const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
 await t.action(internal.clientDelivery.send,{deliveryId});
 expect(fetchMock).not.toHaveBeenCalled();
 expect((await t.run(ctx=>ctx.db.get(deliveryId)))?.status).toBe('cancelled');
 const events=await t.run(ctx=>ctx.db.query('requestEvents').take(10));expect(events.filter(e=>e.kind==='generation_started')).toHaveLength(1);
});
it('requires the exact failed job and error for one operator recovery attempt',async()=>{
 const t=convexTest(schema,modules);await t.mutation(internal.requests.store,input);
 const job=await t.mutation(internal.automation.claim,{protocol:2,leaseToken:'d'.repeat(40)});
 await t.run(ctx=>ctx.db.patch(job!.jobId,{attempts:3}));
 await t.mutation(internal.automation.fail,{jobId:job!.jobId,leaseToken:job!.leaseToken,error:'Missing README'});
 const failures=await t.run(ctx=>ctx.db.query('requestJobAttempts').withIndex('by_job_id',q=>q.eq('jobId',job!.jobId)).take(10));
 expect(failures.map(({attempt,stage,error,failedAt})=>({attempt,stage,error,failedAt}))).toEqual([{attempt:3,stage:'designing',error:'Missing README',failedAt:expect.any(Number)}]);
 expect((await t.query(internal.requests.getVisitorThread,{accessTokenHash:input.accessTokenHash}))?.status).toBe('failed');
 expect((await t.query(internal.requests.getVisitorThread,{accessTokenHash:input.accessTokenHash}))?.messages.at(-1)?.text).toContain('Повторно отправлять заявку не нужно');
 const args={requestId:input.requestId,jobId:job!.jobId,expectedError:'Missing README'};
 expect(await t.mutation(internal.automation.retryFailedJob,{...args,requestId:'#different'})).toBe(false);
 expect(await t.mutation(internal.automation.retryFailedJob,{...args,expectedError:'Other error'})).toBe(false);
 expect(await t.mutation(internal.automation.retryFailedJob,args)).toBe(true);
 expect((await t.query(internal.requests.getVisitorThread,{accessTokenHash:input.accessTokenHash}))?.status).toBe('in_progress');
 expect(await t.mutation(internal.automation.retryFailedJob,args)).toBe(false);
 const resumed=await t.mutation(internal.automation.claim,{protocol:2,requestId:input.requestId,leaseToken:'e'.repeat(40)});
 expect(resumed?.jobId).toBe(job!.jobId);
 expect((await t.run(ctx=>ctx.db.get(job!.jobId)))?.attempts).toBe(3);
 expect((await t.run(ctx=>ctx.db.get(job!.jobId)))?.error).toBeUndefined();
 expect(await t.run(ctx=>ctx.db.query('requestJobAttempts').withIndex('by_job_id',q=>q.eq('jobId',job!.jobId)).take(10))).toHaveLength(1);
});
it('backfills pre-history attempt errors once for the exact failed job',async()=>{
 const t=convexTest(schema,modules);await t.mutation(internal.requests.store,input);
 const job=await t.mutation(internal.automation.claim,{protocol:2,leaseToken:'d'.repeat(40)});
 await t.run(ctx=>ctx.db.patch(job!.jobId,{status:'failed',attempts:3,error:'Final error',leaseToken:undefined,leaseUntil:undefined}));
 const args={requestId:input.requestId,jobId:job!.jobId,expectedError:'Final error',errors:[
  {attempt:1,stage:'checking' as const,error:'First error',failedAt:1},
  {attempt:2,stage:'checking' as const,error:'Second error',failedAt:2},
  {attempt:3,stage:'designing' as const,error:'Final error',failedAt:3},
 ]};
 expect(await t.mutation(internal.automation.backfillAttemptErrors,args)).toBe(true);
 expect(await t.mutation(internal.automation.backfillAttemptErrors,args)).toBe(false);
 await t.run(ctx=>ctx.db.insert('requestJobAttempts',{requestId:input.requestId,jobId:job!.jobId,attempt:3,stage:'checking',error:'Recovery error',failedAt:4}));
 expect(await t.mutation(internal.automation.renumberAttemptErrors,{requestId:input.requestId,jobId:job!.jobId,expectedError:'Final error'})).toBe(4);
 const history=await t.run(ctx=>ctx.db.query('requestJobAttempts').withIndex('by_job_id',q=>q.eq('jobId',job!.jobId)).order('asc').take(10));
 expect(history.map(item=>item.attempt)).toEqual([1,2,3,4]);
});
it('dispatches a queued generation immediately from a Convex action',async()=>{
 const t=convexTest(schema,modules);await t.mutation(internal.requests.store,input);
 const job=await t.run(ctx=>ctx.db.query('requestJobs').first());
 vi.stubEnv('REQUEST_GENERATION_EXECUTOR_URL','https://executor.example.test/generate');
 vi.stubEnv('AUTOMATION_WORKER_SECRET','worker-secret');
 const fetchMock=vi.fn().mockResolvedValue(new Response(null,{status:202}));vi.stubGlobal('fetch',fetchMock);
 await t.action(internal.generation.begin,{jobId:job!._id});
 expect(fetchMock).toHaveBeenCalledOnce();
 const [url,options]=fetchMock.mock.calls[0];
 expect(String(url)).toBe('https://executor.example.test/generate');
 expect(options.headers['X-Lazysoft-Executor-Token']).toBe('worker-secret');
 expect(options.headers['X-Ycf-Container-Integration-Type']).toBe('async');
 expect(JSON.parse(options.body)).toEqual({jobId:job!._id,requestId:input.requestId});
 expect((await t.run(ctx=>ctx.db.get(job!._id)))?.status).toBe('queued');
 expect((await t.run(ctx=>ctx.db.get(job!._id)))?.dispatchAttempts).toBe(1);
});
it('claims only the exact job requested by a hosted executor',async()=>{
 const t=convexTest(schema,modules);await t.mutation(internal.requests.store,input);
 await t.mutation(internal.requests.store,{...input,requestId:'#other-job',accessTokenHash:'c'.repeat(64),adminTokenHash:'d'.repeat(64)});
 const jobs=await t.run(ctx=>ctx.db.query('requestJobs').take(10));
 const target=jobs.find(job=>job.requestId===input.requestId)!;
 const claimed=await t.mutation(internal.automation.claim,{protocol:2,jobId:target._id,requestId:input.requestId,leaseToken:'e'.repeat(40)});
 expect(claimed?.jobId).toBe(target._id);
 expect(claimed?.requestId).toBe(input.requestId);
 expect((await t.run(ctx=>ctx.db.get(jobs.find(job=>job.requestId==='#other-job')!._id)))?.status).toBe('queued');
});
it('keeps a queued job durable and schedules another dispatch after executor failure',async()=>{
 const t=convexTest(schema,modules);await t.mutation(internal.requests.store,input);
 const job=await t.run(ctx=>ctx.db.query('requestJobs').first());
 vi.stubEnv('REQUEST_GENERATION_EXECUTOR_URL','https://executor.example.test/generate');
 vi.stubEnv('AUTOMATION_WORKER_SECRET','worker-secret');
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
 await t.action(internal.generation.begin,{jobId:job!._id});
 expect((await t.run(ctx=>ctx.db.get(job!._id)))?.dispatchAttempts).toBe(1);
});
