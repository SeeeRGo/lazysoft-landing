import { v } from "convex/values";
import { internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { canPurchase } from "./automationModel";
import { getAutomation, event } from "./automation";

const payment = v.object({
  orderId: v.id("sourcePayments"), requestId: v.string(), receiptEmail: v.string(),
  status: v.string(), paymentId: v.optional(v.string()), confirmationUrl: v.optional(v.string()), createdAt: v.number(),
});

export const reserve = internalMutation({
  args: { accessTokenHash: v.string(), receiptEmail: v.string() }, returns: payment,
  handler: async (ctx, args): Promise<typeof payment.type> => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.receiptEmail) || args.receiptEmail.length > 254) throw new Error("Укажите почту для чека");
    const request = await ctx.db.query("mvpRequests").withIndex("by_access_token_hash", q => q.eq("accessTokenHash", args.accessTokenHash)).unique();
    if (!request) throw new Error("Заявка не найдена");
    const state = await getAutomation(ctx, request.requestId);
    if (!state || !canPurchase(state) || !state.sourceStorageId) throw new Error("Исходники ещё не готовы к покупке");
    if (state.paid) throw new Error("Исходники уже оплачены");
    const previous = await ctx.db.query("sourcePayments").withIndex("by_request_id", q => q.eq("requestId", request.requestId)).order("desc").first();
    if (previous && previous.status !== "canceled") {
      // A lost provider response must be reconciled with the same idempotency key.
      // Never create a second charge merely because the browser retries.
      if (previous.status === "creating" && Date.now() - previous.createdAt > 23 * 3600_000) throw new Error("Проверяем предыдущую попытку оплаты. Напишите разработчику.");
      return { orderId: previous._id, requestId: previous.requestId, receiptEmail: previous.receiptEmail, status: previous.status, createdAt: previous.createdAt, ...(previous.paymentId ? { paymentId: previous.paymentId } : {}), ...(previous.confirmationUrl ? { confirmationUrl: previous.confirmationUrl } : {}) };
    }
    const createdAt = Date.now();
    const orderId = await ctx.db.insert("sourcePayments", { requestId: request.requestId, receiptEmail: args.receiptEmail, status: "creating", createdAt });
    await event(ctx, request.requestId, "checkout_started", orderId, "");
    return { orderId, requestId: request.requestId, receiptEmail: args.receiptEmail, status: "creating", createdAt };
  },
});

export const attach = internalMutation({
  args: { orderId: v.id("sourcePayments"), paymentId: v.string(), confirmationUrl: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order || (order.paymentId && order.paymentId !== args.paymentId)) throw new Error("Payment mismatch");
    const other = await ctx.db.query("sourcePayments").withIndex("by_payment_id", q => q.eq("paymentId", args.paymentId)).unique();
    if (other && other._id !== order._id) throw new Error("Payment already assigned");
    if (order.status === "creating") await ctx.db.patch(order._id, { paymentId: args.paymentId, confirmationUrl: args.confirmationUrl, status: "pending" });
    return null;
  },
});

export const knownPayment = internalQuery({
  args: { paymentId: v.string() }, returns: v.union(v.null(), v.object({ orderId: v.id("sourcePayments"), requestId: v.string(), status: v.string(), confirmationUrl: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    const order = await ctx.db.query("sourcePayments").withIndex("by_payment_id", q => q.eq("paymentId", args.paymentId)).unique();
    return order ? { orderId: order._id, requestId: order.requestId, status: order.status, ...(order.confirmationUrl ? { confirmationUrl: order.confirmationUrl } : {}) } : null;
  },
});

export const settle = internalMutation({
  args: { paymentId: v.string(), succeeded: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const order = await ctx.db.query("sourcePayments").withIndex("by_payment_id", q => q.eq("paymentId", args.paymentId)).unique();
    if (!order) throw new Error("Unknown payment");
    if (order.status === "succeeded") return null;
    await ctx.db.patch(order._id, { status: args.succeeded ? "succeeded" : "canceled", ...(args.succeeded ? { paidAt: Date.now() } : {}) });
    if (args.succeeded) {
      const state = await getAutomation(ctx, order.requestId);
      if (!state) throw new Error("Missing automation");
      await ctx.db.patch(state._id, { paid: true, updatedAt: Date.now() });
      await event(ctx, order.requestId, "payment_succeeded", order._id, "");
    }
    return null;
  },
});

async function provider(path: string, method = "GET", body?: unknown, key?: string) {
  const shop = process.env.YOOKASSA_SHOP_ID;
  const secret = process.env.YOOKASSA_SECRET_KEY;
  if (!shop || !secret) throw new Error("Оплата пока не подключена");
  const response = await fetch(`https://api.yookassa.ru/v3/${path}`, {
    method, headers: { Authorization: `Basic ${btoa(`${shop}:${secret}`)}`, "Content-Type": "application/json", ...(key ? { "Idempotence-Key": key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Не удалось связаться с платёжным сервисом. Повторите позже.");
  return response.json();
}

export function verifiedPayment(value: { id?: string; status?: string; paid?: boolean; test?: boolean; amount?: { value?: string; currency?: string }; metadata?: { orderId?: string }; recipient?: { account_id?: string } }, expected: { paymentId: string; orderId: string; shopId: string; test: boolean }) {
  return value.id === expected.paymentId && value.amount?.value === "5000.00" && value.amount.currency === "RUB" && value.metadata?.orderId === expected.orderId && value.recipient?.account_id === expected.shopId && value.test === expected.test;
}

export const reconcile = internalAction({
  args: { paymentId: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!/^[a-zA-Z0-9-]{10,64}$/.test(args.paymentId)) return false;
    const order = await ctx.runQuery(internal.payments.knownPayment, args);
    if (!order) return false;
    const result = await provider(`payments/${encodeURIComponent(args.paymentId)}`);
    if (!verifiedPayment(result, { paymentId: args.paymentId, orderId: order.orderId, shopId: process.env.YOOKASSA_SHOP_ID ?? "", test: process.env.YOOKASSA_MODE !== "live" })) throw new Error("Payment verification failed");
    if (result.status === "succeeded" && result.paid === true) await ctx.runMutation(internal.payments.settle, { paymentId: args.paymentId, succeeded: true });
    else if (result.status === "canceled") await ctx.runMutation(internal.payments.settle, { paymentId: args.paymentId, succeeded: false });
    return true;
  },
});

export const checkout = internalAction({
  args: { accessTokenHash: v.string(), receiptEmail: v.string() }, returns: v.object({ confirmationUrl: v.union(v.string(), v.null()) }),
  handler: async (ctx, args): Promise<{ confirmationUrl: string | null }> => {
    if (!process.env.YOOKASSA_SHOP_ID || !process.env.YOOKASSA_SECRET_KEY) throw new Error("Оплата пока не подключена");
    let order = await ctx.runMutation(internal.payments.reserve, args);
    if (order.paymentId) {
      await ctx.runAction(internal.payments.reconcile, { paymentId: order.paymentId });
      const current = await ctx.runQuery(internal.payments.knownPayment, { paymentId: order.paymentId });
      if (current?.status === "succeeded") return { confirmationUrl: null };
      if (current?.status !== "canceled") return { confirmationUrl: current?.confirmationUrl ?? null };
      order = await ctx.runMutation(internal.payments.reserve, args);
    }
    const vatCode = Number(process.env.YOOKASSA_VAT_CODE);
    if (!Number.isInteger(vatCode) || vatCode < 1 || vatCode > 12) throw new Error("Не настроены параметры чека");
    const result = await provider("payments", "POST", {
      amount: { value: "5000.00", currency: "RUB" }, capture: true,
      confirmation: { type: "redirect", return_url: `${process.env.PUBLIC_SITE_URL || "https://lazysoft.ru"}/request/?payment=return` },
      description: `Исходники демо ${order.requestId}`,
      metadata: { orderId: order.orderId },
      receipt: { customer: { email: order.receiptEmail }, items: [{ description: "Архив исходников демоверсии", quantity: "1.00", amount: { value: "5000.00", currency: "RUB" }, vat_code: vatCode, payment_mode: "full_payment", payment_subject: "intellectual_activity" }] },
    }, order.orderId);
    if (!result.id || (result.test === true) !== (process.env.YOOKASSA_MODE !== "live")) throw new Error("Режим магазина не совпадает с настройками");
    const confirmationUrl = result.confirmation?.confirmation_url;
    if (confirmationUrl && new URL(confirmationUrl).protocol !== "https:") throw new Error("Invalid checkout URL");
    await ctx.runMutation(internal.payments.attach, { orderId: order.orderId, paymentId: result.id, ...(confirmationUrl ? { confirmationUrl } : {}) });
    await ctx.runAction(internal.payments.reconcile, { paymentId: result.id });
    return { confirmationUrl: confirmationUrl ?? null };
  },
});

export const latestForVisitor = internalQuery({
  args: { accessTokenHash: v.string() }, returns: v.union(v.null(), v.object({ paymentId: v.optional(v.string()), status: v.string() })),
  handler: async (ctx, args) => {
    const request = await ctx.db.query("mvpRequests").withIndex("by_access_token_hash", q => q.eq("accessTokenHash", args.accessTokenHash)).unique();
    if (!request) throw new Error("Заявка не найдена");
    const order = await ctx.db.query("sourcePayments").withIndex("by_request_id", q => q.eq("requestId", request.requestId)).order("desc").first();
    return order ? { status: order.status, ...(order.paymentId ? { paymentId: order.paymentId } : {}) } : null;
  },
});

export const refresh = internalAction({
  args: { accessTokenHash: v.string() }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const latest = await ctx.runQuery(internal.payments.latestForVisitor, args);
    if (latest?.paymentId && latest.status === "pending") await ctx.runAction(internal.payments.reconcile, { paymentId: latest.paymentId });
    return null;
  },
});

export const download = internalMutation({
  args: { accessTokenHash: v.string() }, returns: v.string(),
  handler: async (ctx, args) => {
    const request = await ctx.db.query("mvpRequests").withIndex("by_access_token_hash", q => q.eq("accessTokenHash", args.accessTokenHash)).unique();
    if (!request) throw new Error("Заявка не найдена");
    const state = await getAutomation(ctx, request.requestId);
    if (!state?.paid || !state.sourceStorageId) throw new Error("Исходники доступны после оплаты");
    const url = await ctx.storage.getUrl(state.sourceStorageId);
    if (!url) throw new Error("Архив не найден");
    await event(ctx, request.requestId, "source_downloaded", state.sourceStorageId, "");
    return url;
  },
});
