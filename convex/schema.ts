import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  mvpRequests: defineTable({
    requestId: v.string(),
    idea: v.string(),
    contactMethod: v.union(v.literal("telegram"), v.literal("email"), v.literal("max")),
    contact: v.string(),
    source: v.object({
      utmSource: v.string(),
      utmMedium: v.optional(v.string()),
      utmCampaign: v.string(),
      utmContent: v.string(),
      utmTerm: v.string(),
      referrer: v.string(),
    }),
    receivedAt: v.number(),
  }).index("by_request_id", ["requestId"]),
});
