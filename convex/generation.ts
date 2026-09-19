"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Convex owns durable dispatch. The executor is an HTTP service, not a laptop or
 * GitHub runner; it uses the existing leased /automation-worker protocol for the
 * long-running generation, validation, packaging and publication steps.
 */
export const begin = internalAction({
  args: { jobId: v.id("requestJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    if (process.env.REQUEST_AUTOMATION_ENABLED !== "true") return null;
    const payload = await ctx.runQuery(internal.automation.dispatchPayload, { jobId });
    if (!payload) return null;
    const url = process.env.REQUEST_GENERATION_EXECUTOR_URL?.trim();
    const secret = process.env.AUTOMATION_WORKER_SECRET?.trim();
    if (!url || !secret) {
      await ctx.runMutation(internal.automation.retryDispatch, { jobId, expectedAttempts: payload.dispatchAttempts });
      return null;
    }
    try {
      const endpoint = new URL(url);
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Invalid executor URL");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "X-Lazysoft-Executor-Token": secret,
          "Content-Type": "application/json",
          "X-Ycf-Container-Integration-Type": "async",
        },
        body: JSON.stringify({ jobId, requestId: payload.requestId }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status !== 202 && !response.ok) throw new Error(`Executor HTTP ${response.status}`);
      // A Yandex async 202 acknowledges enqueueing, not execution. Keep a
      // durable confirmation loop until the executor actually claims the job;
      // dispatchPayload becomes null as soon as the job leaves `queued`.
      await ctx.runMutation(internal.automation.retryDispatch, { jobId, expectedAttempts: payload.dispatchAttempts });
    } catch {
      await ctx.runMutation(internal.automation.retryDispatch, { jobId, expectedAttempts: payload.dispatchAttempts });
    }
    return null;
  },
});
