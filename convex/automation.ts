import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { automationSummary, canPurchase, canRequestRevision, clientEvent, demoId, demoOption, hostingOption, jobKind, offerVariant, purchaseOption, revisionCount, sourceVariant, workStage } from "./automationModel";

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
    requestId, phase: "queued", revisionUsed: false, revisionCount: 0, accepted: false, paid: false,
    developmentRequested: false, updatedAt: now,
  });
  await ctx.db.insert("requestJobs", {
    requestId, kind: "initial", targetDemoId: "1", status: "queued", instructions: "", attempts: 0, availableAt: now,
  });
}

export const summary = internalQuery({
  args: { accessTokenHash: v.string() }, returns: v.union(v.null(), automationSummary),
  handler: async (ctx, { accessTokenHash }) => {
    const request = await ctx.db.query("mvpRequests").withIndex("by_access_token_hash", q => q.eq("accessTokenHash", accessTokenHash)).unique();
    if (!request) return null;
    const state = await getAutomation(ctx, request.requestId);
    if (!state) return null;
    const job = await ctx.db.query("requestJobs").withIndex("by_request_id", q => q.eq("requestId", request.requestId)).order("desc").first();
    const stage = state.phase === "failed" ? "failed" as const : ["review", "complete"].includes(state.phase) ? "ready" as const : ["queued", "revision_queued"].includes(state.phase) ? "queued" as const : job?.stage ?? "designing" as const;
    return { progress: { stage, queuedAt: job?._creationTime ?? request.receivedAt, ...(job?.startedAt ? { startedAt: job.startedAt } : {}), ...(job?.heartbeatAt ? { heartbeatAt: job.heartbeatAt } : {}), serverTime: Date.now() }, phase: state.phase, revisionUsed: state.revisionUsed, accepted: state.accepted, paid: state.paid, developmentRequested: state.developmentRequested,
      revisionCount: revisionCount(state), revisionLimit: state.revisionCount === undefined ? 1 : 2,
      canRevise: canRequestRevision(state), canBuy: canPurchase(state) && !state.paid,
      sourcePurchaseRequested: state.sourcePurchaseRequested ?? false,
      offerRequestKeys: state.offerRequestKeys ?? [],
      ...(request.contactMethod !== "none" ? { purchaseContact: { method: request.contactMethod, value: request.contact } } : {}),
      demoOptions: state.demoOptions ?? (state.demoUrl ? [{ id: "1" as const, title: "Версия 1", demoUrl: state.demoUrl }] : []),
      ...(state.selectedDemoId ? { selectedDemoId: state.selectedDemoId } : {}),
      messengerConnected: false, // Compatibility for cached clients; bots notify the owner only.
    };
  },
});

export const clientAction = internalMutation({
  args: {
    accessTokenHash: v.string(),
    kind: v.union(v.literal("viewed"), v.literal("opened_pdf"), v.literal("opened_demo"), v.literal("revision_requested"), v.literal("accepted"), v.literal("development_requested"), v.literal("source_purchase_requested"), v.literal("offer_purchase_requested"), v.literal("demo_selected")),
    text: v.optional(v.string()),
    demoId: v.optional(demoId),
    hosting: v.optional(hostingOption),
    purchase: v.optional(purchaseOption),
    offerVariant: v.optional(offerVariant),
    contactMethod: v.optional(v.union(v.literal("telegram"), v.literal("email"), v.literal("max"))),
    contact: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const request = await ctx.db.query("mvpRequests").withIndex("by_access_token_hash", q => q.eq("accessTokenHash", args.accessTokenHash)).unique();
    if (!request) return { ok: false, error: "Заявка не найдена" };
    const state = await getAutomation(ctx, request.requestId);
    if (!state) return { ok: false, error: "Автоматическая обработка этой заявки не включена" };
    const now = Date.now();
    const text = args.text?.trim() ?? "";
    const availableOptions = state.demoOptions ?? (state.demoUrl ? [{ id: "1" as const, title: "Версия 1", demoUrl: state.demoUrl }] : []);
    let eventKey = args.kind === "opened_demo" && args.demoId
      ? `${String(state.sourceStorageId ?? "initial")}:${args.demoId}`
      : ["viewed", "opened_pdf", "opened_demo"].includes(args.kind) ? String(state.sourceStorageId ?? state.pdfStorageId ?? "initial") : "once";
    let eventText = text;
    if (args.kind === "revision_requested") {
      if (!canRequestRevision(state)) return { ok: false, error: "Дождитесь текущей версии. Для новой заявки доступны два сообщения с доработками" };
      if (text.length < 10 || text.length > 3000) return { ok: false, error: "Опишите правки: от 10 до 3000 символов" };
      const sequential = state.revisionCount !== undefined;
      const latest = [...(state.demoOptions ?? [])].sort((a, b) => Number(b.id) - Number(a.id))[0];
      const baseDemoId = sequential ? latest!.id : state.selectedDemoId ?? "1";
      const targetDemoId = sequential ? String(Number(latest!.id) + 1) as "2" | "3" : baseDemoId;
      if (!sequential && (state.demoOptions?.length ?? 0) > 1 && !state.selectedDemoId) return { ok: false, error: "Сначала выберите версию для правок" };
      const count = revisionCount(state) + 1;
      await ctx.db.patch(state._id, { phase: "revision_queued", revisionUsed: true, ...(sequential ? { revisionCount: count } : {}), updatedAt: now });
      const jobId = await ctx.db.insert("requestJobs", { requestId: request.requestId, kind: "revision", targetDemoId, baseDemoId, status: "queued", instructions: text, attempts: 0, availableAt: now });
      eventKey = jobId;
      eventText = `Доработки ${count} из ${sequential ? 2 : 1}, версия ${baseDemoId} → ${targetDemoId}:\n${text}`;
      await ctx.db.insert("mvpRequestMessages", { requestId: request.requestId, sender: "visitor", text: eventText, createdAt: now });
      await ctx.db.patch(request._id, { status: "in_progress", updatedAt: now });
    } else if (args.kind === "accepted") {
      if (!["review", "complete"].includes(state.phase)) return { ok: false, error: "Дождитесь результата" };
      if ((state.demoOptions?.length ?? 0) > 1 && !state.selectedDemoId) return { ok: false, error: "Сначала выберите одну из трёх версий" };
      await ctx.db.patch(state._id, { accepted: true, phase: "complete", updatedAt: now });
    } else if (args.kind === "demo_selected") {
      if (!canPurchase(state)) return { ok: false, error: "Версии сайта ещё готовятся" };
      const chosen = args.demoId ? availableOptions.find(option => option.id === args.demoId) : undefined;
      if (!chosen) return { ok: false, error: "Выберите доступную версию" };
      await ctx.db.patch(state._id, { selectedDemoId: chosen.id, updatedAt: now });
      eventKey = chosen.id;
      eventText = `Клиент выбрал версию ${chosen.id}: ${chosen.title}`;
    } else if (args.kind === "offer_purchase_requested") {
      if (!canPurchase(state) || state.paid) return { ok: false, error: "Сначала посмотрите и примите результат" };
      const chosen = args.demoId ? availableOptions.find(option => option.id === args.demoId) : undefined;
      if (!chosen || !args.hosting || !args.purchase || !args.offerVariant) return { ok: false, error: "Выберите версию сайта и вариант размещения" };
      const prices = args.offerVariant === "budget" ? { source: 3000, setup: 2000 } : { source: 5000, setup: 3000 };
      const requestKey = `${chosen.id}:${args.hosting}:${args.purchase}:${args.offerVariant}`;
      if ((state.offerRequestKeys ?? []).includes(requestKey)) return { ok: true };
      if ((state.offerRequestKeys ?? []).length >= 3) return { ok: false, error: "Запрос уже отправлен. Уточните выбор в чате ниже" };
      const method = args.contactMethod ?? request.contactMethod;
      const contact = (args.contact ?? request.contact).trim();
      if (method === "none" || contact.length < 3 || contact.length > 200) return { ok: false, error: "Укажите контакт для согласования покупки" };
      if (method === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return { ok: false, error: "Проверьте адрес электронной почты" };
      await ctx.db.patch(request._id, { contactMethod: method, contact, updatedAt: now });
      const total = prices.source + (args.purchase === "source_and_setup" ? prices.setup : 0);
      const hostingLabel = args.hosting === "cloudflare" ? "Cloudflare" : "HostiMan";
      const purchaseLabel = args.purchase === "source_and_setup" ? `исходники и помощь с установкой (${prices.source} + ${prices.setup} ₽)` : `исходники (${prices.source} ₽)`;
      const message = `Хочу купить версию ${chosen.id} «${chosen.title}»: ${hostingLabel}, ${purchaseLabel}. Итого ${total} ₽. Давайте обсудим оплату и передачу в этом чате.`;
      await ctx.db.patch(state._id, { sourcePurchaseRequested: true, offerRequestKeys: [...(state.offerRequestKeys ?? []), requestKey], selectedDemoId: chosen.id, updatedAt: now });
      await ctx.db.insert("mvpRequestMessages", { requestId: request.requestId, sender: "visitor", text: message, createdAt: now });
      eventKey = requestKey;
      eventText = `Контакт (${method}): ${contact}\nИдея: ${request.idea}\n${message}\nОплата не подтверждена.`;
    } else if (args.kind === "source_purchase_requested") {
      if (!canPurchase(state) || state.paid) return { ok: false, error: "Сначала посмотрите и примите результат" };
      if (state.sourcePurchaseRequested) return { ok: true };
      await ctx.db.patch(state._id, { sourcePurchaseRequested: true, updatedAt: now });
      await ctx.db.insert("mvpRequestMessages", {
        requestId: request.requestId, sender: "visitor", text: "Хочу купить исходники за 5 000 ₽. Давайте обсудим оплату и передачу в этом чате.", createdAt: now,
      });
      eventText = `Контакт (${request.contactMethod}): ${request.contact}\nИдея: ${request.idea}\nОбсудите оплату и передачу исходников в чате заявки. Оплата не подтверждена.`;
    } else if (args.kind === "development_requested") {
      if (!["review", "complete"].includes(state.phase)) return { ok: false, error: "Сначала дождитесь готовой версии" };
      if (text.length > 3000) return { ok: false, error: "Слишком длинное описание" };
      await ctx.db.patch(state._id, { developmentRequested: true, updatedAt: now });
      if (!state.developmentRequested) await ctx.db.insert("mvpRequestMessages", {
        requestId: request.requestId, sender: "visitor", text: `Хочу заказать доработку от 10 000 ₽ с постоплатой.\n${text}`, createdAt: now,
      });
    } else if (args.kind !== "viewed" && !canPurchase(state)) {
      return { ok: false, error: "Результат ещё готовится" };
    }
    // Clicks are deduplicated per artifact version; business actions per explicit offer choice.
    await event(ctx, request.requestId, args.kind, eventKey, eventText);
    await ctx.db.patch(request._id, { updatedAt: now });
    return { ok: true };
  },
});

const claimResult = v.object({
  jobId: v.id("requestJobs"), requestId: v.string(), kind: jobKind,
  idea: v.string(), instructions: v.string(), leaseToken: v.string(),
  sourceStorageId: v.optional(v.id("_storage")),
  selectedDemoId: v.optional(demoId),
  demoOptions: v.optional(v.array(demoOption)),
  targetDemoId: demoId,
  baseDemoId: v.optional(demoId),
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
  args: { leaseToken: v.string(), requestId: v.optional(v.string()), protocol: v.optional(v.number()) }, returns: v.union(v.null(), claimResult),
  handler: async (ctx, { leaseToken, requestId, protocol }) => {
    if (protocol !== 2) return null;
    if (process.env.REQUEST_AUTOMATION_ENABLED !== "true") return null;
    if (process.env.REQUEST_AUTOMATION_ALLOWED_REQUEST_ID && requestId !== process.env.REQUEST_AUTOMATION_ALLOWED_REQUEST_ID) return null;
    if (leaseToken.length < 32 || leaseToken.length > 100) throw new Error("Invalid lease token");
    const now = Date.now();
    // Reclaim only expired leases, preserving the revision budget and previous artifact.
    let job;
    if (requestId) {
      // A request has the initial job and up to two revision jobs; never claim another request.
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
      await ctx.db.patch(request._id, { status: "failed", updatedAt: now });
      await ctx.db.insert("mvpRequestMessages", { requestId: job.requestId, sender: "system", text: "Автоматическая генерация остановилась после нескольких попыток. Заявка и идея сохранены, разработчик получил уведомление и проверит её вручную. Повторно отправлять заявку не нужно.", createdAt: now });
      await event(ctx, job.requestId, "generation_failed", job._id, "Исчерпаны попытки выполнения; требуется проверка разработчика.");
      return null;
    }
    const targetDemoId = job.targetDemoId ?? (job.kind === "initial" ? "1" : state.selectedDemoId ?? "1");
    const baseDemoId = job.baseDemoId ?? (job.kind === "revision" ? state.selectedDemoId ?? "1" : undefined);
    await ctx.db.patch(job._id, { targetDemoId, baseDemoId, status: "running", startedAt: job.startedAt ?? now, heartbeatAt: now, stage: "designing", attempts: job.attempts + 1, leaseToken, leaseUntil: now + 5 * 60_000 });
    await ctx.db.patch(state._id, { phase: job.kind === "initial" ? "generating" : "revising", ...(job.kind === "initial" ? { revisionCount: 0 } : {}), updatedAt: now });
    await ctx.db.patch(request._id, { status: "in_progress", updatedAt: now });
    await event(ctx, job.requestId, "generation_started", job._id, `Началась работа над версией ${targetDemoId}. Обычно подготовка занимает до 15 минут.
Идея: ${request.idea}`);

    return { jobId: job._id, requestId: job.requestId, kind: job.kind, idea: request.idea, instructions: job.instructions, leaseToken,
      targetDemoId, ...(baseDemoId ? { baseDemoId } : {}),
      ...(state.sourceStorageId ? { sourceStorageId: state.sourceStorageId } : {}),
      ...(state.selectedDemoId ? { selectedDemoId: state.selectedDemoId } : {}),
      ...(state.demoOptions ? { demoOptions: state.demoOptions } : {}),
    };
  },
});

export const heartbeat = internalMutation({
  args: { jobId: v.id("requestJobs"), leaseToken: v.string(), stage: v.optional(workStage) }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running" || job.leaseToken !== args.leaseToken || (job.leaseUntil ?? 0) < Date.now()) return false;
    await ctx.db.patch(job._id, { leaseUntil: Date.now() + 5 * 60_000, heartbeatAt: Date.now(), ...(args.stage ? { stage: args.stage } : {}) });
    return true;
  },
});

export const complete = internalMutation({
  args: { jobId: v.id("requestJobs"), leaseToken: v.string(), pdfStorageId: v.optional(v.id("_storage")), sourceStorageId: v.id("_storage"), sourceVariants: v.optional(v.array(sourceVariant)), demoUrl: v.optional(v.string()), demoOptions: v.optional(v.array(demoOption)), text: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseToken !== args.leaseToken) return false;
    if (job.status === "succeeded") return true;
    if (job.status !== "running" || (job.leaseUntil ?? 0) < Date.now()) return false;
    const allowedOrigin = process.env.REQUEST_DEMO_ORIGIN;
    const options = args.demoOptions ?? (args.demoUrl ? [{ id: "1" as const, title: "Версия 1", demoUrl: args.demoUrl }] : []);
    if (options.length !== 1 || options[0].id !== (job.targetDemoId ?? "1")) throw new Error("Only the job's target version may be completed");
    const expectedOrigin = allowedOrigin ? new URL(allowedOrigin).origin : "";
    for (const option of options) {
      const url = new URL(option.demoUrl);
      if (!expectedOrigin || url.origin !== expectedOrigin || url.protocol !== "https:" || url.username || url.password || !option.title.trim() || option.title.length > 160) throw new Error("Demo origin not configured or invalid");
    }
    if (!args.text.trim() || args.text.length > 5000) throw new Error("Invalid result text");
    const pdf = args.pdfStorageId ? await ctx.db.system.get(args.pdfStorageId) : null;
    const archive = await ctx.db.system.get(args.sourceStorageId);
    if ((args.pdfStorageId && (!pdf || pdf.contentType !== "application/pdf")) || !archive || !["application/zip", "application/octet-stream"].includes(archive.contentType ?? "")) throw new Error("Missing artifacts");
    if (args.demoOptions) {
      if (!args.sourceVariants || args.sourceVariants.length !== 1 || args.sourceVariants[0].id !== options[0].id) throw new Error("The generated version requires its own source archive");
      for (const item of args.sourceVariants) {
        const source = await ctx.db.system.get(item.storageId);
        if (!source || !["application/zip", "application/octet-stream"].includes(source.contentType ?? "")) throw new Error("Missing source variant");
      }
    }
    const state = await getAutomation(ctx, job.requestId);
    const request = await ctx.db.query("mvpRequests").withIndex("by_request_id", q => q.eq("requestId", job.requestId)).unique();
    if (!state || !request) throw new Error("Missing request");
    const now = Date.now();
    const previousOptions = state.demoOptions ?? (state.demoUrl ? [{ id: "1" as const, title: "Версия 1", demoUrl: state.demoUrl }] : []);
    if (state.revisionCount !== undefined && job.kind === "revision" && previousOptions.some(option => option.id === options[0].id)) throw new Error("A saved version cannot be overwritten");
    const mergedOptions = [...previousOptions.filter(option => option.id !== options[0].id), ...options].sort((a, b) => Number(a.id) - Number(b.id));
    const previousSources = state.sourceVariants ?? (state.sourceStorageId && previousOptions.length === 1 ? [{ id: previousOptions[0].id, storageId: state.sourceStorageId }] : []);
    const mergedSources = [...previousSources.filter(source => source.id !== options[0].id), ...(args.sourceVariants ?? [{ id: options[0].id, storageId: args.sourceStorageId }])].sort((a, b) => Number(a.id) - Number(b.id));
    const finished = state.revisionCount === undefined ? job.kind === "revision" : state.revisionCount >= 2;
    await ctx.db.patch(state._id, { phase: finished ? "complete" : "review", pdfStorageId: args.pdfStorageId, sourceStorageId: args.sourceStorageId, sourceVariants: mergedSources, demoUrl: options[0].demoUrl, demoOptions: mergedOptions, selectedDemoId: state.selectedDemoId ?? options[0].id, updatedAt: now });
    await ctx.db.patch(job._id, { status: "succeeded", completedAt: now, error: undefined, leaseUntil: undefined });
    await ctx.db.patch(request._id, { status: "ready", updatedAt: now });
    await ctx.db.insert("mvpRequestMessages", { requestId: job.requestId, sender: "owner", text: args.text, demoUrl: options[0].demoUrl, pdfStorageId: args.pdfStorageId, createdAt: now });
    await event(ctx, job.requestId, "result_ready", job._id, `Версия ${options[0].id} готова\n${options.map(option => `${option.id}. ${option.title}: ${option.demoUrl}`).join("\n")}`);
    if (request.contactMethod === "email") {
      const deliveryId = await ctx.db.insert("requestDeliveries", { requestId: job.requestId, jobId: job._id, status: "pending", attempts: 0 });
      await ctx.scheduler.runAfter(0, internal.clientDelivery.send, { deliveryId });
    }
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
    const now = Date.now();
    const state = await getAutomation(ctx, job.requestId);
    if (state) await ctx.db.patch(state._id, { phase: terminal ? "failed" : job.kind === "initial" ? "queued" : "revision_queued", updatedAt: now });
    if (terminal) {
      const request = await ctx.db.query("mvpRequests").withIndex("by_request_id", q => q.eq("requestId", job.requestId)).unique();
      if (request) await ctx.db.patch(request._id, { status: "failed", updatedAt: now });
      await ctx.db.insert("mvpRequestMessages", { requestId: job.requestId, sender: "system", text: "Автоматическая генерация остановилась после нескольких попыток. Заявка и идея сохранены, разработчик получил уведомление и проверит её вручную. Повторно отправлять заявку не нужно.", createdAt: now });
      await event(ctx, job.requestId, "generation_failed", job._id, "Автоматическая подготовка не завершилась после трёх попыток; требуется проверка разработчика.");
    }
    return true;
  },
});

// Explicit operator recovery only; never called by a client or automatic retry.
export const retryFailedJob = internalMutation({
  args: { requestId: v.string(), jobId: v.id("requestJobs"), expectedError: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const state = await getAutomation(ctx, args.requestId);
    const latest = await ctx.db.query("requestJobs").withIndex("by_request_id", q => q.eq("requestId", args.requestId)).order("desc").first();
    if (!job || job.requestId !== args.requestId || job.status !== "failed" || job.error !== args.expectedError || state?.phase !== "failed" || latest?._id !== job._id) return false;
    await ctx.db.patch(job._id, { status: "queued", attempts: 2, availableAt: Date.now(), leaseToken: undefined, leaseUntil: undefined });
    await ctx.db.patch(state._id, { phase: job.kind === "initial" ? "queued" : "revision_queued", updatedAt: Date.now() });
    const request = await ctx.db.query("mvpRequests").withIndex("by_request_id", q => q.eq("requestId", args.requestId)).unique();
    if (request) await ctx.db.patch(request._id, { status: "in_progress", updatedAt: Date.now() });
    return true;
  },
});
