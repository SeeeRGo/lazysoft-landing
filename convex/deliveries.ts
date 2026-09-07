import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAutomation, event } from "./automation";

export const reserve = internalMutation({
  args: { deliveryId: v.id("requestDeliveries") },
  returns: v.union(v.null(), v.object({
    requestId: v.string(), contact: v.string(), contactMethod: v.string(),
    tokenCiphertext: v.optional(v.string()), telegramChatId: v.optional(v.string()), maxUserId: v.optional(v.string()),
    attempt: v.number(), pdfStorageId: v.optional(v.id("_storage")), demoUrl: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status === "sent" || (delivery.status === "sending" && (delivery.leaseUntil ?? 0) > Date.now())) return null;
    if (delivery.attempts >= 8) {
      await ctx.db.patch(delivery._id, { status: "failed" });
      await event(ctx, delivery.requestId, "delivery_failed", delivery._id, "Исчерпаны попытки доставки клиенту; результат сохранён на странице заявки.");
      return null;
    }
    const request = await ctx.db.query("mvpRequests").withIndex("by_request_id", q => q.eq("requestId", delivery.requestId)).unique();
    const state = await getAutomation(ctx, delivery.requestId);
    if (!request || !state) throw new Error("Missing delivery context");
    await ctx.db.patch(delivery._id, { status: "sending", attempts: delivery.attempts + 1, leaseUntil: Date.now() + 120_000 });
    // Watchdog recovers an interrupted action, independently of provider retries.
    await ctx.scheduler.runAfter(125_000, internal.clientDelivery.send, args);
    return {
      requestId: request.requestId, contact: request.contact, contactMethod: request.contactMethod, attempt: delivery.attempts + 1,
      ...(request.deliveryTokenCiphertext ? { tokenCiphertext: request.deliveryTokenCiphertext } : {}),
      ...(request.telegramChatId ? { telegramChatId: request.telegramChatId } : {}),
      ...(request.maxUserId ? { maxUserId: request.maxUserId } : {}),
      ...(state.pdfStorageId ? { pdfStorageId: state.pdfStorageId } : {}), ...(state.demoUrl ? { demoUrl: state.demoUrl } : {}),
    };
  },
});
export const finish = internalMutation({
  args: { deliveryId: v.id("requestDeliveries"), attempt: v.number(), sent: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deliveryId);
    if (!row || row.status === "sent" || row.attempts !== args.attempt) return null;
    await ctx.db.patch(row._id, { status: args.sent ? "sent" : row.attempts >= 8 ? "failed" : "pending", ...(args.sent ? { sentAt: Date.now() } : {}) });
    if (!args.sent && row.attempts >= 8) await event(ctx, row.requestId, "delivery_failed", row._id, "Результат есть на странице заявки, но не удалось отправить уведомление клиенту. Проверьте канал связи.");
    return null;
  },
});

export const bindMessenger = internalMutation({
  args: { accessTokenHash: v.string(), channel: v.union(v.literal("telegram"), v.literal("max")), recipientId: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const request = await ctx.db.query("mvpRequests").withIndex("by_access_token_hash", q => q.eq("accessTokenHash", args.accessTokenHash)).unique();
    if (!request) return false;
    const field = args.channel === "telegram" ? "telegramChatId" : "maxUserId";
    if (request[field] && request[field] !== args.recipientId) return false;
    await ctx.db.patch(request._id, { [field]: args.recipientId });
    await event(ctx, request.requestId, "messenger_connected", args.channel, args.channel === "telegram" ? "Клиент подключил Telegram-бота" : "Клиент подключил MAX-бота");
    const deliveries = await ctx.db.query("requestDeliveries").withIndex("by_request_id", q => q.eq("requestId", request.requestId)).take(2);
    for (const delivery of deliveries) {
      if (delivery.status === "sent" || (delivery.status === "sending" && (delivery.leaseUntil ?? 0) > Date.now())) continue;
      await ctx.db.patch(delivery._id, { status: "pending", attempts: 0 });
      await ctx.scheduler.runAfter(0, internal.clientDelivery.send, { deliveryId: delivery._id });
    }
    return true;
  },
});
