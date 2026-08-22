import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

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

export default http;
