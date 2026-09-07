import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { automationSummary, canPurchase, canRequestRevision, clientEvent, jobKind } from "./automationModel";

export async function getAutomation(ctx: QueryCtx, requestId: string) {
  return ctx.db.query("requestAutomations").withIndex("by_request_id", q => q.eq("requestId", requestId)).unique();
}

export async function event(ctx: MutationCtx, requestId: string, kind: typeof clientEvent.type, key: string, text: string) {
  const dedupeKey = `${requestId}:${kind}:${key}`;
  const existing = await ctx.db.query("requestEvents").withIndex("by_dedupe_key", q => q.eq("dedupeKey", dedupeKey)).unique();
  if (existing) return;
  const eventId = await ctx.db.insert("requestEvents", { requestId, kind, dedupeKey, text, createdAt: Date.now(), attempts: 0 });
  await ctx.scheduler.runAfter(0, internal.automationNotifications.deliver, { eventId });
}

export async function enqueueInitial(ctx: MutationCtx, requestId: string) {
  if (await getAutomation(ctx, requestId)) return;
  const now = Date.now();
  await ctx.db.insert("requestAutomations", {
    requestId, phase: "queued", revisionUsed: false, accepted: false, paid: false,
    developmentRequested: false, updatedAt: now,
  });
  await ctx.db.insert("requestJobs", {
    requestId, kind: "initial", status: "queued", instructions: "", attempts: 0, availableAt: now,
  });
}

export const summary = internalQuery({
  args: { accessTokenHash: v.string() }, returns: v.union(v.null(), automationSummary),
  handler: async (ctx, { accessTokenHash }) => {
    const request = await ctx.db.query("mvpRequests").withIndex("by_access_token_hash", q => q.eq("accessTokenHash", accessTokenHash)).unique();
    if (!request) return null;
    const state = await getAutomation(ctx, request.requestId);
    if (!state) return null;
    return { phase: state.phase, revisionUsed: state.revisionUsed, accepted: state.accepted, paid: state.paid, developmentRequested: state.developmentRequested,
      sourcePurchaseRequested: state.sourcePurchaseRequested ?? false,
      messengerConnected: Boolean(request.telegramChatId || request.maxUserId),
      ...(process.env.TELEGRAM_BOT_USERNAME ? { telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME } : {}),
      ...(process.env.MAX_BOT_USERNAME ? { maxBotUsername: process.env.MAX_BOT_USERNAME } : {}),
    };
  },
});

export const clientAction = internalMutation({
  args: {
    accessTokenHash: v.string(),
    kind: v.union(v.literal("viewed"), v.literal("opened_pdf"), v.literal("opened_demo"), v.literal("revision_requested"), v.literal("accepted"), v.literal("development_requested"), v.literal("source_purchase_requested")),
    text: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const request = await ctx.db.query("mvpRequests").withIndex("by_access_token_hash", q => q.eq("accessTokenHash", args.accessTokenHash)).unique();
    if (!request) return { ok: false, error: "Заявка не найдена" };
    const state = await getAutomation(ctx, request.requestId);
    if (!state) return { ok: false, error: "Автоматическая обработка этой заявки не включена" };
    const now = Date.now();
    const text = args.text?.trim() ?? "";
    if (args.kind === "revision_requested") {
      if (!canRequestRevision(state)) return { ok: false, error: "Доступен только один раунд правок до принятия результата" };
      if (text.length < 10 || text.length > 3000) return { ok: false, error: "Опишите правки: от 10 до 3000 символов" };
      await ctx.db.patch(state._id, { phase: "revision_queued", revisionUsed: true, updatedAt: now });
      await ctx.db.insert("requestJobs", { requestId: request.requestId, kind: "revision", status: "queued", instructions: text, attempts: 0, availableAt: now });
      await ctx.db.insert("mvpRequestMessages", { requestId: request.requestId, sender: "visitor", text: `Правки к демо и ТЗ:\n${text}`, createdAt: now });
      await ctx.db.patch(request._id, { status: "in_progress", updatedAt: now });
    } else if (args.kind === "accepted") {
      if (!["review", "complete"].includes(state.phase)) return { ok: false, error: "Дождитесь результата" };
      await ctx.db.patch(state._id, { accepted: true, phase: "complete", updatedAt: now });
    } else if (args.kind === "source_purchase_requested") {
      if (!canPurchase(state) || state.paid) return { ok: false, error: "Сначала посмотрите и примите результат" };
      if (state.sourcePurchaseRequested) return { ok: true };
      await ctx.db.patch(state._id, { sourcePurchaseRequested: true, updatedAt: now });
      await ctx.db.insert("mvpRequestMessages", {
        requestId: request.requestId, sender: "visitor", text: "Хочу купить исходники за 5 000 ₽. Давайте обсудим оплату и передачу в этом чате.", createdAt: now,
      });
    } else if (args.kind === "development_requested") {
      if (state.phase !== "complete") return { ok: false, error: "Сначала посмотрите и примите результат" };
      if (text.length > 3000) return { ok: false, error: "Слишком длинное описание" };
      await ctx.db.patch(state._id, { developmentRequested: true, updatedAt: now });
      if (!state.developmentRequested) await ctx.db.insert("mvpRequestMessages", {
        requestId: request.requestId, sender: "visitor", text: `Хочу заказать доработку от 10 000 ₽ с постоплатой.\n${text}`, createdAt: now,
      });
    } else if (args.kind !== "viewed" && !["review", "complete"].includes(state.phase)) {
      return { ok: false, error: "Результат ещё готовится" };
    }
    // Clicks are deduplicated per artifact version; business actions occur once per request.
    const key = ["viewed", "opened_pdf", "opened_demo"].includes(args.kind) ? (state.pdfStorageId ?? "initial") : "once";
    await event(ctx, request.requestId, args.kind, key, args.kind === "source_purchase_requested"
      ? `Контакт (${request.contactMethod}): ${request.contact}\nИдея: ${request.idea}\nОбсудите оплату и передачу исходников в чате заявки. Оплата не подтверждена.` : text);
    await ctx.db.patch(request._id, { updatedAt: now });
    return { ok: true };
  },
});

const claimResult = v.object({
  jobId: v.id("requestJobs"), requestId: v.string(), kind: jobKind,
  idea: v.string(), instructions: v.string(), leaseToken: v.string(),
  sourceStorageId: v.optional(v.id("_storage")),
});
export const previousSource = internalQuery({
  args: { jobId: v.id("requestJobs"), leaseToken: v.string() }, returns: v.union(v.null(), v.id("_storage")),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running" || job.leaseToken !== args.leaseToken || (job.leaseUntil ?? 0) < Date.now()) return null;
    const state = await getAutomation(ctx, job.requestId);
    return state?.sourceStorageId ?? null;
  },
});
export const claim = internalMutation({
  args: { leaseToken: v.string(), requestId: v.optional(v.string()) }, returns: v.union(v.null(), claimResult),
  handler: async (ctx, { leaseToken, requestId }) => {
    if (process.env.REQUEST_AUTOMATION_ENABLED !== "true") return null;
    if (process.env.REQUEST_AUTOMATION_ALLOWED_REQUEST_ID && requestId !== process.env.REQUEST_AUTOMATION_ALLOWED_REQUEST_ID) return null;
    if (leaseToken.length < 32 || leaseToken.length > 100) throw new Error("Invalid lease token");
    const now = Date.now();
    // Reclaim only expired leases, preserving the revision budget and previous artifact.
    let job;
    if (requestId) {
      // A request has at most the initial job and one revision; never fall back to another request.
      const jobs = await ctx.db.query("requestJobs").withIndex("by_request_id", q => q.eq("requestId", requestId)).take(3);
      job = jobs.find(row => row.status === "running" && (row.leaseUntil ?? Infinity) < now)
        ?? jobs.find(row => row.status === "queued" && row.availableAt <= now) ?? null;
    } else {
      job = await ctx.db.query("requestJobs").withIndex("by_status_and_lease_until", q => q.eq("status", "running").lt("leaseUntil", now)).first();
      if (!job) job = await ctx.db.query("requestJobs").withIndex("by_status_and_available_at", q => q.eq("status", "queued").lte("availableAt", now)).first();
    }
    if (!job) return null;
    const state = await getAutomation(ctx, job.requestId);
    const request = await ctx.db.query("mvpRequests").withIndex("by_request_id", q => q.eq("requestId", job.requestId)).unique();
    if (!state || !request) throw new Error("Missing request");
    if (job.attempts >= 3) {
      await ctx.db.patch(job._id, { status: "failed", error: "Исчерпаны попытки выполнения" });
      await ctx.db.patch(state._id, { phase: "failed", updatedAt: now });
      await event(ctx, job.requestId, "generation_failed", job._id, "Исчерпаны попытки выполнения; требуется проверка разработчика.");
      return null;
    }
    await ctx.db.patch(job._id, { status: "running", attempts: job.attempts + 1, leaseToken, leaseUntil: now + 5 * 60_000 });
    await ctx.db.patch(state._id, { phase: job.kind === "initial" ? "generating" : "revising", updatedAt: now });
    await ctx.db.patch(request._id, { status: "in_progress", updatedAt: now });
    return { jobId: job._id, requestId: job.requestId, kind: job.kind, idea: request.idea, instructions: job.instructions, leaseToken, ...(state.sourceStorageId ? { sourceStorageId: state.sourceStorageId } : {}) };
  },
});

export const heartbeat = internalMutation({
  args: { jobId: v.id("requestJobs"), leaseToken: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running" || job.leaseToken !== args.leaseToken || (job.leaseUntil ?? 0) < Date.now()) return false;
    await ctx.db.patch(job._id, { leaseUntil: Date.now() + 5 * 60_000 });
    return true;
  },
});

export const complete = internalMutation({
  args: { jobId: v.id("requestJobs"), leaseToken: v.string(), pdfStorageId: v.id("_storage"), sourceStorageId: v.id("_storage"), demoUrl: v.string(), text: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseToken !== args.leaseToken) return false;
    if (job.status === "succeeded") return true;
    if (job.status !== "running" || (job.leaseUntil ?? 0) < Date.now()) return false;
    const url = new URL(args.demoUrl);
    const allowedOrigin = process.env.REQUEST_DEMO_ORIGIN;
    if (!allowedOrigin || url.origin !== new URL(allowedOrigin).origin || url.protocol !== "https:" || url.username || url.password) throw new Error("Demo origin not configured or invalid");
    if (!args.text.trim() || args.text.length > 5000) throw new Error("Invalid result text");
    const pdf = await ctx.db.system.get(args.pdfStorageId);
    const archive = await ctx.db.system.get(args.sourceStorageId);
    if (!pdf || pdf.contentType !== "application/pdf" || !archive || !["application/zip", "application/octet-stream"].includes(archive.contentType ?? "")) throw new Error("Missing artifacts");
    const state = await getAutomation(ctx, job.requestId);
    const request = await ctx.db.query("mvpRequests").withIndex("by_request_id", q => q.eq("requestId", job.requestId)).unique();
    if (!state || !request) throw new Error("Missing request");
    const now = Date.now();
    await ctx.db.patch(state._id, { phase: job.kind === "initial" ? "review" : "complete", pdfStorageId: args.pdfStorageId, sourceStorageId: args.sourceStorageId, demoUrl: url.href, updatedAt: now });
    await ctx.db.patch(job._id, { status: "succeeded", completedAt: now, error: undefined, leaseUntil: undefined });
    await ctx.db.patch(request._id, { status: "ready", updatedAt: now });
    await ctx.db.insert("mvpRequestMessages", { requestId: job.requestId, sender: "owner", text: args.text, demoUrl: url.href, pdfStorageId: args.pdfStorageId, createdAt: now });
    await event(ctx, job.requestId, "result_ready", job._id, `${job.kind === "initial" ? "Первый результат" : "Правки готовы"}\n${url.href}`);
    const deliveryId = await ctx.db.insert("requestDeliveries", { requestId: job.requestId, jobId: job._id, status: "pending", attempts: 0 });
    await ctx.scheduler.runAfter(0, internal.clientDelivery.send, { deliveryId });
    return true;
  },
});

export const fail = internalMutation({
  args: { jobId: v.id("requestJobs"), leaseToken: v.string(), error: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running" || job.leaseToken !== args.leaseToken || (job.leaseUntil ?? 0) < Date.now()) return false;
    const terminal = job.attempts >= 3;
    await ctx.db.patch(job._id, { status: terminal ? "failed" : "queued", availableAt: Date.now() + 60_000 * job.attempts, error: args.error.slice(0, 1000), leaseUntil: undefined, leaseToken: undefined });
    const state = await getAutomation(ctx, job.requestId);
    if (state) await ctx.db.patch(state._id, { phase: terminal ? "failed" : job.kind === "initial" ? "queued" : "revision_queued", updatedAt: Date.now() });
    if (terminal) await event(ctx, job.requestId, "generation_failed", job._id, "Автоматическая подготовка не завершилась после трёх попыток; требуется проверка разработчика.");
    return true;
  },
});
