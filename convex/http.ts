import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { endpoint as portfolioEndpoint } from './portfolioHttp';

const http = httpRouter();
for (const method of ['GET','POST','OPTIONS'] as const) http.route({path:'/portfolio-03212396',method,handler:portfolioEndpoint});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isAuthorized(request: Request) {
  const expectedSecret = process.env.REQUEST_INGEST_SECRET;
  const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expectedSecret && providedSecret === expectedSecret);
}

http.route({
  path: "/mvp-request",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    try {
      const payload = await request.json();
      const result = await ctx.runMutation(internal.requests.store, payload);
      return json({ ok: true, ...result });
    } catch (error) {
      console.error("MVP request ingest failed", error);
      return json({ error: "Invalid request" }, 400);
    }
  }),
});

http.route({
  path: "/request-thread",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    try {
      const payload = await request.json();
      const thread = await ctx.runQuery(internal.requests.getVisitorThread, payload);
      return thread ? json({ ok: true, thread }) : json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Request thread read failed", error);
      return json({ error: "Invalid request" }, 400);
    }
  }),
});

http.route({
  path: "/request-thread/message",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    try {
      const payload = await request.json();
      const result = await ctx.runMutation(internal.requests.addVisitorMessage, payload);
      return result.sent ? json({ ok: true, requestId: result.requestId }) : json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Visitor request message failed", error);
      return json({ error: "Invalid request" }, 400);
    }
  }),
});

http.route({
  path: "/request-admin/thread",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    try {
      const payload = await request.json();
      const thread = await ctx.runQuery(internal.requests.getAdminThread, payload);
      return thread ? json({ ok: true, thread }) : json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Admin request thread read failed", error);
      return json({ error: "Invalid request" }, 400);
    }
  }),
});

http.route({
  path: "/request-admin/message",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    try {
      const payload = await request.json();
      const result = await ctx.runMutation(internal.requests.addOwnerMessage, payload);
      return result.sent ? json({ ok: true }) : json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Owner request message failed", error);
      return json({ error: "Invalid request" }, 400);
    }
  }),
});

http.route({
  path: "/request-automation", method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);
    try {
      const payload = await request.json();
      const { operation, ...args } = payload;
      if (operation === "summary") return json({ ok: true, automation: await ctx.runQuery(internal.automation.summary, args) });
      if (operation === "action") return json(await ctx.runMutation(internal.automation.clientAction, args));
      if (operation === "checkout") return json({ ok: false, error: "Оплата и передача исходников обсуждаются в чате заявки." }, 400);
      if (operation === "refresh-payment") { await ctx.runAction(internal.payments.refresh, args); return json({ ok: true }); }
      if (operation === "download") return json({ ok: true, url: await ctx.runMutation(internal.payments.download, args) });
      return json({ error: "Unknown operation" }, 400);
    } catch {
      return json({ error: "Не удалось выполнить действие. Проверьте состояние заявки или повторите позже." }, 400);
    }
  }),
});

http.route({
  path: "/automation-worker", method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.AUTOMATION_WORKER_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Unauthorized" }, 401);
    try {
      const { operation, ...args } = await request.json();
      if (operation === "claim") return json({ job: await ctx.runMutation(internal.automation.claim, args) });
      if (operation === "heartbeat") return json({ ok: await ctx.runMutation(internal.automation.heartbeat, args) });
      if (operation === "complete") return json({ ok: await ctx.runMutation(internal.automation.complete, args) });
      if (operation === "fail") return json({ ok: await ctx.runMutation(internal.automation.fail, args) });
      if (operation === "upload" || operation === "source") {
        // Validate active lease before releasing an upload URL or the previous source archive.
        const active = await ctx.runMutation(internal.automation.heartbeat, { jobId: args.jobId, leaseToken: args.leaseToken });
        if (!active) return json({ error: "Expired lease" }, 409);
        if (operation === "upload") return json({ url: await ctx.storage.generateUploadUrl() });
        const sourceId = await ctx.runQuery(internal.automation.previousSource, { jobId: args.jobId, leaseToken: args.leaseToken });
        return json({ url: sourceId ? await ctx.storage.getUrl(sourceId) : null });
      }
      return json({ error: "Unknown operation" }, 400);
    } catch {
      return json({ error: "Invalid worker request" }, 400);
    }
  }),
});

http.route({
  path: "/yookassa-webhook", method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const payload = await request.json();
      if (!["payment.succeeded", "payment.canceled"].includes(payload.event)) return json({ ok: true });
      if (typeof payload.object?.id !== "string") return json({ error: "Invalid payment" }, 400);
      // The payload is a hint only. The action fetches the payment using shop credentials.
      await ctx.runAction(internal.payments.reconcile, { paymentId: payload.object.id });
      return json({ ok: true });
    } catch {
      return json({ error: "Verification pending" }, 503);
    }
  }),
});

for (const channel of ["telegram", "max"] as const) {
  http.route({
    path: `/${channel}-request-webhook`, method: "POST",
    handler: httpAction(async (ctx, request) => {
      const secret = channel === "telegram" ? process.env.TELEGRAM_WEBHOOK_SECRET : process.env.MAX_WEBHOOK_SECRET;
      const header = channel === "telegram" ? "x-telegram-bot-api-secret-token" : "x-max-bot-api-secret";
      if (!secret || request.headers.get(header) !== secret) return json({ error: "Unauthorized" }, 401);
      try {
        const payload = await request.json();
        let token: string | undefined;
        let recipientId: string | undefined;
        if (channel === "telegram") {
          if (payload.message?.chat?.type !== "private") return json({ ok: true });
          token = typeof payload.message?.text === "string" ? payload.message.text.match(/^\/start ([A-Za-z0-9_-]{43})$/)?.[1] : undefined;
          recipientId = String(payload.message?.chat?.id ?? "");
        } else {
          if (payload.update_type !== "bot_started") return json({ ok: true });
          token = typeof payload.payload === "string" ? payload.payload : undefined;
          recipientId = String(payload.user?.user_id ?? "");
        }
        if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[0-9]{1,20}$/.test(recipientId)) return json({ ok: true });
        const hashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        const accessTokenHash = Array.from(new Uint8Array(hashBytes), byte => byte.toString(16).padStart(2, "0")).join("");
        await ctx.runMutation(internal.deliveries.bindMessenger, { channel, recipientId, accessTokenHash });
        return json({ ok: true });
      } catch {
        return json({ error: "Could not connect messenger" }, 503);
      }
    }),
  });
}

export default http;
