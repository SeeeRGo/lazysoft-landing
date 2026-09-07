"use node";

import { createDecipheriv } from "node:crypto";
import nodemailer from "nodemailer";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const send = internalAction({
  args: { deliveryId: v.id("requestDeliveries") }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const delivery = await ctx.runMutation(internal.deliveries.reserve, args);
    if (!delivery) return null;
    let sent = false;
    try {
      const key = process.env.DELIVERY_ENCRYPTION_KEY;
      if (!key || !/^[a-fA-F0-9]{64}$/.test(key) || !delivery.tokenCiphertext) throw new Error("Delivery key unavailable");
      const encrypted = Buffer.from(delivery.tokenCiphertext, "base64");
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), encrypted.subarray(0, 12));
      decipher.setAuthTag(encrypted.subarray(12, 28));
      const token = Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString("utf8");
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid page token");
      const pageUrl = `${process.env.PUBLIC_SITE_URL || "https://lazysoft.ru"}/request/#${token}`;
      const pdfUrl = delivery.pdfStorageId ? await ctx.storage.getUrl(delivery.pdfStorageId) : null;
      const text = `Демоверсия по вашей заявке ${delivery.requestId} готовы.\n\nСтраница результата и правок: ${pageUrl}\n${pdfUrl ? `ТЗ (PDF): ${pdfUrl}\n` : ""}${delivery.demoUrl ? `Демо: ${delivery.demoUrl}\n` : ""}\nПосмотрите результат. На странице заявки можно один раз попросить правки, забрать исходники за 5 000 ₽ или обсудить доработку от 10 000 ₽ с постоплатой.\n\nСергей · Lazysoft`;
      if (delivery.telegramChatId) {
        const bot = process.env.TELEGRAM_BOT_TOKEN;
        if (!bot) throw new Error("Telegram unavailable");
        const response = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: delivery.telegramChatId, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(15_000),
        });
        sent = response.ok && (await response.json()).ok === true;
      } else if (delivery.maxUserId) {
        if (!process.env.MAX_BOT_TOKEN) throw new Error("MAX unavailable");
        const response = await fetch(`https://platform-api2.max.ru/messages?user_id=${encodeURIComponent(delivery.maxUserId)}`, {
          method: "POST", headers: { Authorization: process.env.MAX_BOT_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000),
        });
        sent = response.ok;
      } else if (delivery.contactMethod === "email") {
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.SMTP_FROM) throw new Error("SMTP unavailable");
        const transport = nodemailer.createTransport({
          host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: process.env.SMTP_SECURE !== "false",
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }, connectionTimeout: 15_000, socketTimeout: 20_000,
        });
        try {
          const result = await transport.sendMail({ from: process.env.SMTP_FROM, to: delivery.contact, subject: `Демо вашей идеи · Lazysoft ${delivery.requestId}`, text, messageId: `<${args.deliveryId}@lazysoft.ru>`, disableFileAccess: true, disableUrlAccess: true });
          sent = result.accepted.length > 0;
        } finally { transport.close(); }
      }
    } catch {
      console.warn("Client delivery pending", args.deliveryId, delivery.attempt);
    }
    await ctx.runMutation(internal.deliveries.finish, { ...args, attempt: delivery.attempt, sent });
    if (!sent && delivery.attempt < 8) await ctx.scheduler.runAfter(Math.min(3_600_000, 60_000 * 2 ** delivery.attempt), internal.clientDelivery.send, args);
    return null;
  },
});
