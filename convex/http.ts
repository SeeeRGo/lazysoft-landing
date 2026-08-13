import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/mvp-request",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expectedSecret = process.env.REQUEST_INGEST_SECRET;
    const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const payload = await request.json();
      const result = await ctx.runMutation(internal.requests.store, payload);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("MVP request ingest failed", error);
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

export default http;
