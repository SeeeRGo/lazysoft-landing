import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { internal } from "../convex/_generated/api";
import { verifiedPayment } from "../convex/payments";

const modules = import.meta.glob("../convex/**/*.ts");
const token = "a".repeat(64);
async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.requests.store, {
    requestId: "#test0001", idea: "Сайт записи в мастерскую по ремонту велосипедов", contact: "test@example.com", contactMethod: "email", requestType: "mvp",
    accessTokenHash: token, adminTokenHash: "b".repeat(64), receivedAt: Date.now(),
    source: { utmSource: "test", utmCampaign: "test", utmContent: "", utmTerm: "", referrer: "" },
  });
  return t;
}
async function ready(t: Awaited<ReturnType<typeof setup>>, complete = false) {
  return t.run(async ctx => {
    const state = await ctx.db.query("requestAutomations").first();
    const sourceStorageId = await ctx.storage.store(new Blob(["source fixture"], { type: "application/zip" }));
    const pdfStorageId = await ctx.storage.store(new Blob(["%PDF-fixture"], { type: "application/pdf" }));
    // convex-test's storeBlob omits MIME metadata; emulate the real HTTP upload metadata.
    await ctx.db.patch(sourceStorageId as never, { contentType: "application/zip" } as never);
    await ctx.db.patch(pdfStorageId as never, { contentType: "application/pdf" } as never);
    await ctx.db.patch(state!._id, { phase: complete ? "complete" : "review", accepted: complete, sourceStorageId, pdfStorageId, selectedDemoId: "1", sourceVariants: [{ id: "1", storageId: sourceStorageId }], demoOptions: [{ id: "1", title: "Версия 1", demoUrl: "https://demo.example.org/1/" }] });
    return { sourceStorageId, pdfStorageId };
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("REQUEST_AUTOMATION_ENABLED", "true");
  vi.stubEnv("REQUEST_DEMO_ORIGIN", "https://demo.example.org");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("request lifecycle", () => {
  it("creates versions sequentially, limits follow-ups to two, and sells any preserved version", async () => {
    const t = await setup();
    const completeVersion = async (job: { jobId: Id<"requestJobs">; leaseToken: string; targetDemoId: "1" | "2" | "3" }) => {
      const storageId = await t.run(async ctx => {
        const id = await ctx.storage.store(new Blob([`version ${job.targetDemoId}`], { type: "application/zip" }));
        await ctx.db.patch(id as never, { contentType: "application/zip" } as never);
        return id;
      });
      await t.mutation(internal.automation.complete, { jobId: job.jobId, leaseToken: job.leaseToken,
        sourceStorageId: storageId, sourceVariants: [{ id: job.targetDemoId, storageId }],
        demoOptions: [{ id: job.targetDemoId, title: `Версия ${job.targetDemoId}`, demoUrl: `https://demo.example.org/release-${job.targetDemoId}/` }], text: "Новая версия готова" });
      return storageId;
    };
    const initial = await t.mutation(internal.automation.claim, { protocol: 2, leaseToken: "a".repeat(40) });
    expect(initial?.targetDemoId).toBe("1");
    const source1 = await completeVersion(initial!);
    expect(await t.query(internal.automation.summary, { accessTokenHash: token })).toMatchObject({ phase: "review", revisionCount: 0, revisionLimit: 2, canRevise: true, canBuy: true, selectedDemoId: "1" });
    const readyEvents = await t.run(ctx => ctx.db.query("requestEvents").take(10));
    expect(readyEvents.find(event => event.kind === "result_ready")?.text).toContain("Уведомить клиента (почта): test@example.com");
    expect(await t.run(ctx => ctx.db.query("requestDeliveries").take(10))).toHaveLength(0);
    const purchase = { accessTokenHash: token, kind: "offer_purchase_requested" as const, hosting: "cloudflare" as const, purchase: "source" as const, offerVariant: "standard" as const };
    expect((await t.mutation(internal.automation.clientAction, { ...purchase, demoId: "1" })).ok).toBe(true);
    const revision = { accessTokenHash: token, kind: "revision_requested" as const, text: "Добавьте цены на ремонт велосипедов" };
    const parallel = await Promise.all([t.mutation(internal.automation.clientAction, revision), t.mutation(internal.automation.clientAction, revision)]);
    expect(parallel.filter(r => r.ok)).toHaveLength(1);
    expect(await t.query(internal.automation.summary, { accessTokenHash: token })).toMatchObject({ revisionCount: 1, canRevise: false, canBuy: true });
    const second = await t.mutation(internal.automation.claim, { protocol: 2, leaseToken: "b".repeat(40) });
    expect(second).toMatchObject({ targetDemoId: "2", baseDemoId: "1" });
    const source2 = await completeVersion(second!);
    expect(await t.query(internal.automation.summary, { accessTokenHash: token })).toMatchObject({ phase: "review", revisionCount: 1, canRevise: true, canBuy: true });
    await t.mutation(internal.automation.clientAction, { accessTokenHash: token, kind: "demo_selected", demoId: "1" });
    expect((await t.mutation(internal.automation.clientAction, { ...revision, text: "Сделайте контакты и кнопку записи крупнее" })).ok).toBe(true);
    const third = await t.mutation(internal.automation.claim, { protocol: 2, leaseToken: "c".repeat(40) });
    expect(third).toMatchObject({ targetDemoId: "3", baseDemoId: "2" });
    await expect(t.mutation(internal.automation.complete, { jobId: third!.jobId, leaseToken: third!.leaseToken, sourceStorageId: source1,
      sourceVariants: [{ id: "1", storageId: source1 }], demoOptions: [{ id: "1", title: "Overwrite", demoUrl: "https://demo.example.org/overwrite/" }], text: "Overwrite" })).rejects.toThrow("target version");
    const source3 = await completeVersion(third!);
    const summary = await t.query(internal.automation.summary, { accessTokenHash: token });
    expect(summary).toMatchObject({ phase: "complete", revisionCount: 2, canRevise: false, canBuy: true });
    expect(summary?.demoOptions.map(o => o.demoUrl)).toEqual([1, 2, 3].map(n => `https://demo.example.org/release-${n}/`));
    expect((await t.mutation(internal.automation.clientAction, revision)).ok).toBe(false);
    expect(await t.run(ctx => ctx.db.query("requestJobs").take(10))).toHaveLength(3);
    const state = await t.run(ctx => ctx.db.query("requestAutomations").first());
    expect(state?.sourceVariants).toEqual([{ id: "1", storageId: source1 }, { id: "2", storageId: source2 }, { id: "3", storageId: source3 }]);
    for (const id of ["1", "2", "3"] as const) expect((await t.mutation(internal.automation.clientAction, { ...purchase, demoId: id })).ok).toBe(true);
    expect((await t.mutation(internal.automation.clientAction, { ...purchase, accessTokenHash: "wrong", demoId: "1" })).ok).toBe(false);
    expect((await t.run(ctx => ctx.db.query("requestEvents").take(30))).filter(e => e.kind === "revision_requested")).toHaveLength(2);
    await expect(t.mutation(internal.payments.download, { accessTokenHash: token })).rejects.toThrow("после оплаты");
  });

  it("keeps a finished version purchasable after a revision exhausts its retries", async () => {
    const t = await setup();
    await ready(t);
    await t.run(async ctx => { const job = await ctx.db.query("requestJobs").first(); await ctx.db.patch(job!._id, { status: "succeeded" }); });
    await t.mutation(internal.automation.clientAction, { accessTokenHash: token, kind: "revision_requested", text: "Добавьте новый раздел услуг" });
    for (let attempt = 0; attempt < 3; attempt++) {
      const job = await t.mutation(internal.automation.claim, { protocol: 2, leaseToken: String(attempt).repeat(40) });
      expect(job?.targetDemoId).toBe("2");
      await t.mutation(internal.automation.fail, { jobId: job!.jobId, leaseToken: job!.leaseToken, error: "Test failure" });
      vi.setSystemTime(Date.now() + 4 * 60_000);
    }
    expect(await t.query(internal.automation.summary, { accessTokenHash: token })).toMatchObject({ phase: "failed", revisionCount: 1, canBuy: true, canRevise: true });
    expect((await t.mutation(internal.automation.clientAction, { accessTokenHash: token, kind: "revision_requested", text: "Попробуйте другой вариант заголовка" })).ok).toBe(true);
    const retry = await t.mutation(internal.automation.claim, { protocol: 2, leaseToken: "d".repeat(40), requestId: "#test0001" });
    expect(retry?.targetDemoId).toBe("2");
  });
  it("records the selected version, hosting and active offer prices", async () => {
    const t = await setup();
    await ready(t, true);
    await t.run(async ctx => {
      const state = await ctx.db.query("requestAutomations").first();
      await ctx.db.patch(state!._id, { demoOptions: [
        { id: "1", title: "Каталог", demoUrl: "https://demo.example.org/1/" },
        { id: "2", title: "Витрина", demoUrl: "https://demo.example.org/2/" },
        { id: "3", title: "Журнал", demoUrl: "https://demo.example.org/3/" },
      ] });
    });
    expect((await t.mutation(internal.automation.clientAction, { accessTokenHash: token, kind: "demo_selected", demoId: "2" })).ok).toBe(true);
    const action = { accessTokenHash: token, kind: "offer_purchase_requested" as const, demoId: "2" as const, hosting: "hostiman" as const, purchase: "source_and_setup" as const, offerVariant: "budget" as const };
    expect((await t.mutation(internal.automation.clientAction, action)).ok).toBe(true);
    expect((await t.mutation(internal.automation.clientAction, action)).ok).toBe(true);
    const state = await t.query(internal.automation.summary, { accessTokenHash: token });
    expect(state?.selectedDemoId).toBe("2");
    expect(state?.offerRequestKeys).toEqual(["2:hostiman:source_and_setup:budget"]);
    const messages = await t.run(ctx => ctx.db.query("mvpRequestMessages").take(20));
    expect(messages.find(message => message.text.includes("Итого 5000 ₽"))?.text).toContain("HostiMan");
    const events = await t.run(ctx => ctx.db.query("requestEvents").take(20));
    expect(events.filter(event => event.kind === "offer_purchase_requested")).toHaveLength(1);
  });

  it("records a manual source purchase once without charging or granting downloads", async () => {
    const t = await setup();
    const args = { accessTokenHash: token, kind: "source_purchase_requested" as const };
    expect((await t.mutation(internal.automation.clientAction, args)).ok).toBe(false);
    await ready(t, true);
    expect((await t.mutation(internal.automation.clientAction, { ...args, accessTokenHash: "wrong" })).ok).toBe(false);
    const results = await Promise.all([t.mutation(internal.automation.clientAction, args), t.mutation(internal.automation.clientAction, args)]);
    expect(results.every(result => result.ok)).toBe(true);
    const state = await t.query(internal.automation.summary, { accessTokenHash: token });
    expect(state?.sourcePurchaseRequested).toBe(true);
    expect(state?.paid).toBe(false);
    const events = await t.run(ctx => ctx.db.query("requestEvents").take(10));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("source_purchase_requested");
    expect(events[0].text).toContain("test@example.com");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "test-owner-chat");
    const telegram = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", telegram);
    await t.action(internal.automationNotifications.deliver, { eventId: events[0]._id });
    const notification = JSON.parse(telegram.mock.calls[0][1].body);
    expect(notification.chat_id).toBe("test-owner-chat");
    expect(notification.text).toContain("Клиент хочет купить исходники за 5 000 ₽");
    expect(notification.text).toContain("#test0001");
    expect((await t.run(ctx => ctx.db.get(events[0]._id)))?.notifiedAt).toBeTruthy();
    const messages = await t.run(ctx => ctx.db.query("mvpRequestMessages").take(10));
    expect(messages.filter(message => message.text.includes("Хочу купить исходники"))).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("sourcePayments").take(10))).toHaveLength(0);
    await expect(t.mutation(internal.payments.download, { accessTokenHash: token })).rejects.toThrow("после оплаты");
  });
  it("stores exactly one initial job for a duplicate ingest", async () => {
    const t = await setup();
    await t.mutation(internal.requests.store, { requestId: "#test0001", idea: "duplicate", contact: "test@example.com", contactMethod: "email", requestType: "mvp", receivedAt: Date.now(), source: { utmSource: "", utmCampaign: "", utmContent: "", utmTerm: "", referrer: "" } });
    expect(await t.run(ctx => ctx.db.query("requestJobs").take(10))).toHaveLength(1);
  });
  it("admits only one current revision job for parallel duplicate clicks", async () => {
    const t = await setup();
    await ready(t);
    const args = { accessTokenHash: token, kind: "revision_requested" as const, text: "Добавьте выбор времени записи в мастерскую" };
    const results = await Promise.all([t.mutation(internal.automation.clientAction, args), t.mutation(internal.automation.clientAction, args)]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    const jobs = await t.run(ctx => ctx.db.query("requestJobs").take(10));
    expect(jobs.filter(job => job.kind === "revision")).toHaveLength(1);
    expect((await t.query(internal.automation.summary, { accessTokenHash: token }))?.revisionUsed).toBe(true);
  });
  it("rejects revision after acceptance and rejects unauthorized actions", async () => {
    const t = await setup();
    await ready(t);
    await t.mutation(internal.automation.clientAction, { accessTokenHash: token, kind: "accepted" });
    expect((await t.mutation(internal.automation.clientAction, { accessTokenHash: token, kind: "revision_requested", text: "Добавить экран записи" })).ok).toBe(false);
    expect((await t.mutation(internal.automation.clientAction, { accessTokenHash: "wrong", kind: "development_requested" })).ok).toBe(false);
  });
  it("does not expose private source storage in visitor APIs or allow unpaid downloads", async () => {
    const t = await setup();
    const artifacts = await ready(t, true);
    const thread = await t.query(internal.requests.getVisitorThread, { accessTokenHash: token });
    const state = await t.query(internal.automation.summary, { accessTokenHash: token });
    expect(JSON.stringify({ thread, state })).not.toContain(artifacts.sourceStorageId);
    await expect(t.mutation(internal.payments.download, { accessTokenHash: token })).rejects.toThrow("после оплаты");
  });
  it("downloads the selected client package and never falls back to the worker demo bundle", async () => {
    const t = await setup();
    await ready(t, true);
    const clientUrl = await t.run(async ctx => {
      const state = await ctx.db.query("requestAutomations").first();
      const clientId = await ctx.storage.store(new Blob(["server package"], { type: "application/zip" }));
      await ctx.db.patch(state!._id, { paid: true, selectedDemoId: "1", sourceVariants: [{ id: "1", storageId: clientId }] });
      return ctx.storage.getUrl(clientId);
    });
    expect(await t.mutation(internal.payments.download, { accessTokenHash: token })).toBe(clientUrl);
    await t.run(async ctx => { const state = await ctx.db.query("requestAutomations").first(); await ctx.db.patch(state!._id, { sourceVariants: [] }); });
    await expect(t.mutation(internal.payments.download, { accessTokenHash: token })).rejects.toThrow("Комплект выбранной версии");
  });
  it("deduplicates development requests and owner events", async () => {
    const t = await setup();
    await ready(t, true);
    const args = { accessTokenHash: token, kind: "development_requested" as const };
    await t.mutation(internal.automation.clientAction, args);
    await t.mutation(internal.automation.clientAction, args);
    const events = await t.run(ctx => ctx.db.query("requestEvents").take(10));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("development_requested");
  });
});

describe("worker leases", () => {
  it("does not let an old worker claim a sequential job", async () => {
    const t = await setup();
    expect(await t.mutation(internal.automation.claim, { leaseToken: "x".repeat(40) })).toBeNull();
    expect((await t.run(ctx => ctx.db.query("requestJobs").first()))?.attempts).toBe(0);
  });
  it("isolates a targeted test request and respects the server allowlist", async () => {
    const t = await setup();
    const leaseToken = "x".repeat(40);
    expect(await t.mutation(internal.automation.claim, { protocol: 2, leaseToken, requestId: "not-this-request" })).toBeNull();
    vi.stubEnv("REQUEST_AUTOMATION_ALLOWED_REQUEST_ID", "#test0001");
    expect(await t.mutation(internal.automation.claim, { protocol: 2, leaseToken })).toBeNull();
    expect((await t.mutation(internal.automation.claim, { protocol: 2, leaseToken, requestId: "#test0001" }))?.requestId).toBe("#test0001");
    expect(await t.mutation(internal.automation.claim, { protocol: 2, leaseToken, requestId: "#test0001" })).toBeNull();
  });
  it("claims a job once and refuses stale completion after another worker reclaims it", async () => {
    const t = await setup();
    const artifacts = await ready(t);
    const old = await t.mutation(internal.automation.claim, { protocol: 2, leaseToken: "1".repeat(40) });
    expect(old).not.toBeNull();
    expect(await t.mutation(internal.automation.claim, { protocol: 2, leaseToken: "2".repeat(40) })).toBeNull();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    const next = await t.mutation(internal.automation.claim, { protocol: 2, leaseToken: "3".repeat(40) });
    expect(next?.jobId).toBe(old?.jobId);
    const args = { jobId: old!.jobId, leaseToken: old!.leaseToken, ...artifacts, demoUrl: "https://demo.example.org/job/", text: "Готово" };
    expect(await t.mutation(internal.automation.complete, args)).toBe(false);
    expect(await t.mutation(internal.automation.complete, { ...args, leaseToken: next!.leaseToken })).toBe(true);
    expect(await t.mutation(internal.automation.complete, { ...args, leaseToken: next!.leaseToken })).toBe(true);
    const messages = await t.run(ctx => ctx.db.query("mvpRequestMessages").take(10));
    expect(messages.filter(message => message.sender === "owner")).toHaveLength(1);
  });
});

describe("payments", () => {
  it("completes without PDF and clears the previous PDF from current delivery state", async () => {
    const t = await setup();
    const { sourceStorageId } = await ready(t);
    const job = await t.mutation(internal.automation.claim, { protocol: 2, leaseToken: "9".repeat(40) });
    expect(await t.mutation(internal.automation.complete, {
      jobId: job!.jobId, leaseToken: job!.leaseToken, sourceStorageId,
      demoUrl: "https://demo.example.org/new/", text: "Демо готово.",
    })).toBe(true);
    const state = await t.run(ctx => ctx.db.query("requestAutomations").first());
    expect(state?.pdfStorageId).toBeUndefined();
    expect(state?.sourceStorageId).toBe(sourceStorageId);
    const messages = await t.run(ctx => ctx.db.query("mvpRequestMessages").take(10));
    expect(messages.find(message => message.sender === "owner")).toMatchObject({ text: "Демо готово.", demoUrl: "https://demo.example.org/new/" });
  });
  it("refreshes a paid order without returning its old checkout URL", async () => {
    const t = await setup();
    await ready(t, true);
    const args = { accessTokenHash: token, receiptEmail: "test@example.com" };
    const order = await t.mutation(internal.payments.reserve, args);
    await t.mutation(internal.payments.attach, { orderId: order.orderId, paymentId: "paid-provider-123", confirmationUrl: "https://checkout.example.org/old" });
    vi.stubEnv("YOOKASSA_SHOP_ID", "shop1");
    vi.stubEnv("YOOKASSA_SECRET_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      id: "paid-provider-123", status: "succeeded", paid: true, test: true,
      amount: { value: "5000.00", currency: "RUB" }, metadata: { orderId: order.orderId }, recipient: { account_id: "shop1" },
    }), { status: 200 })));
    expect(await t.action(internal.payments.checkout, args)).toEqual({ confirmationUrl: null });
    expect((await t.query(internal.automation.summary, { accessTokenHash: token }))?.paid).toBe(true);
  });
  it("does not trust webhook success when the provider says pending", async () => {
    const t = await setup();
    await ready(t, true);
    const order = await t.mutation(internal.payments.reserve, { accessTokenHash: token, receiptEmail: "test@example.com" });
    await t.mutation(internal.payments.attach, { orderId: order.orderId, paymentId: "provider-payment-123" });
    vi.stubEnv("YOOKASSA_SHOP_ID", "shop1");
    vi.stubEnv("YOOKASSA_SECRET_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "provider-payment-123", status: "pending", paid: false, test: true,
      amount: { value: "5000.00", currency: "RUB" }, metadata: { orderId: order.orderId }, recipient: { account_id: "shop1" },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const response = await t.fetch("/yookassa-webhook", { method: "POST", body: JSON.stringify({ event: "payment.succeeded", object: { id: "provider-payment-123", paid: true } }) });
    expect(response.status).toBe(200);
    expect((await t.query(internal.automation.summary, { accessTokenHash: token }))?.paid).toBe(false);
    await expect(t.mutation(internal.payments.download, { accessTokenHash: token })).rejects.toThrow();
  });
  it("uses one immutable order for retries and duplicate checkout clicks", async () => {
    const t = await setup();
    await ready(t, true);
    const first = await t.mutation(internal.payments.reserve, { accessTokenHash: token, receiptEmail: "first@example.com" });
    const second = await t.mutation(internal.payments.reserve, { accessTokenHash: token, receiptEmail: "second@example.com" });
    expect(first.orderId).toBe(second.orderId);
    expect(second.receiptEmail).toBe("first@example.com");
    await t.mutation(internal.payments.attach, { orderId: first.orderId, paymentId: "test-payment-123" });
    await t.mutation(internal.payments.settle, { paymentId: "test-payment-123", succeeded: true });
    await t.mutation(internal.payments.settle, { paymentId: "test-payment-123", succeeded: true });
    expect(await t.mutation(internal.payments.download, { accessTokenHash: token })).toMatch(/^https?:/);
    const events = await t.run(ctx => ctx.db.query("requestEvents").take(20));
    expect(events.filter(event => event.kind === "payment_succeeded")).toHaveLength(1);
  });
  it("rejects the wrong amount, currency, shop, order, mode or payment ID", () => {
    const expected = { paymentId: "payment1", orderId: "order1", shopId: "shop1", test: true };
    const valid = { id: "payment1", test: true, amount: { value: "5000.00", currency: "RUB" }, metadata: { orderId: "order1" }, recipient: { account_id: "shop1" } };
    expect(verifiedPayment(valid, expected)).toBe(true);
    for (const changed of [
      { ...valid, amount: { value: "1.00", currency: "RUB" } },
      { ...valid, amount: { value: "5000.00", currency: "USD" } },
      { ...valid, recipient: { account_id: "wrong" } }, { ...valid, metadata: { orderId: "wrong" } },
      { ...valid, test: false }, { ...valid, id: "wrong" },
    ]) expect(verifiedPayment(changed, expected)).toBe(false);
  });
});

describe("messenger authorization", () => {
  it("reports a crashed final delivery attempt instead of leaving it sending forever", async () => {
    const t = await setup();
    const deliveryId = await t.run(async ctx => {
      const job = await ctx.db.query("requestJobs").first();
      return ctx.db.insert("requestDeliveries", { requestId: "#test0001", jobId: job!._id, status: "sending", attempts: 8, leaseUntil: Date.now() - 1 });
    });
    expect(await t.mutation(internal.deliveries.reserve, { deliveryId })).toBeNull();
    expect((await t.run(ctx => ctx.db.get(deliveryId)))?.status).toBe("failed");
    const events = await t.run(ctx => ctx.db.query("requestEvents").take(10));
    expect(events.filter(event => event.kind === "delivery_failed")).toHaveLength(1);
  });
  it("refuses an unauthenticated webhook and does not bind client chats", async () => {
    const t = await setup();
    const response = await t.fetch("/telegram-request-webhook", { method: "POST", body: JSON.stringify({ message: { text: "/start fake", chat: { id: 123, type: "private" } } }) });
    expect(response.status).toBe(401);
    expect(await t.mutation(internal.deliveries.bindMessenger, { accessTokenHash: "wrong", channel: "telegram", recipientId: "123" })).toBe(false);
    expect(await t.mutation(internal.deliveries.bindMessenger, { accessTokenHash: token, channel: "telegram", recipientId: "123" })).toBe(false);
    expect(await t.mutation(internal.deliveries.bindMessenger, { accessTokenHash: token, channel: "telegram", recipientId: "456" })).toBe(false);
  });
});
