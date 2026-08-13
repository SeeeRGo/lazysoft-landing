import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const contactMethod = v.union(v.literal("telegram"), v.literal("email"), v.literal("max"));
const source = v.object({
  utmSource: v.string(),
  utmMedium: v.optional(v.string()),
  utmCampaign: v.string(),
  utmContent: v.string(),
  utmTerm: v.string(),
  referrer: v.string(),
});

export const store = internalMutation({
  args: {
    requestId: v.string(),
    idea: v.string(),
    contactMethod,
    contact: v.string(),
    source,
    receivedAt: v.number(),
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mvpRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (existing) return { created: false };
    await ctx.db.insert("mvpRequests", args);
    return { created: true };
  },
});
