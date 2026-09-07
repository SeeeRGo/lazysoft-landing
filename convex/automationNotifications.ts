import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const reserve = internalMutation({
  args: { eventId: v.id("requestEvents") },
  returns: v.union(v.null(), v.object({ requestId: v.string(), kind: v.string(), text: v.string(), attempt: v.number() })),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.notifiedAt || event.attempts >= 8) return null;
    await ctx.db.patch(eventId, { attempts: event.attempts + 1 });
    return { requestId: event.requestId, kind: event.kind, text: event.text, attempt: event.attempts + 1 };
  },
});

export const markDelivered = internalMutation({
  args: { eventId: v.id("requestEvents") }, returns: v.null(),
  handler: async (ctx, { eventId }) => { await ctx.db.patch(eventId, { notifiedAt: Date.now() }); return null; },
});

const labels: Record<string, string> = {
  viewed: "Открыта страница заявки", opened_pdf: "Открыто ТЗ", opened_demo: "Открыто демо",
  revision_requested: "Запрошен единственный раунд правок", accepted: "Результат принят",
  development_requested: "Заказ доработки от 10 000 ₽ с постоплатой",
  checkout_started: "Начата оплата исходников — 5 000 ₽",
  payment_succeeded: "Оплачены исходники — 5 000 ₽", source_downloaded: "Скачаны исходники",
  result_ready: "ТЗ и демо готовы", generation_failed: "Ошибка подготовки заявки",
  delivery_failed: "Не удалось доставить результат клиенту", messenger_connected: "Подключён канал связи",
};

export const deliver = internalAction({
  args: { eventId: v.id("requestEvents") }, returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.runMutation(internal.automationNotifications.reserve, args);
    if (!event) return null;
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (!token || !chatId) throw new Error("Telegram is not configured in Convex");
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `${labels[event.kind] ?? event.kind}\nЗаявка ${event.requestId}\n${event.text}`.slice(0, 4000), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(12_000),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error("Telegram delivery failed");
      await ctx.runMutation(internal.automationNotifications.markDelivered, args);
    } catch {
      // Persisted events survive retries. Never log URLs containing a bot token.
      console.warn("Request notification pending", args.eventId, event.attempt);
      if (event.attempt < 8) await ctx.scheduler.runAfter(Math.min(3_600_000, 30_000 * 2 ** event.attempt), internal.automationNotifications.deliver, args);
    }
    return null;
  },
});
