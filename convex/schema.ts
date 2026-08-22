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
    accessTokenHash: v.optional(v.string()),
    adminTokenHash: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("received"),
        v.literal("in_progress"),
        v.literal("ready"),
        v.literal("closed"),
      ),
    ),
    updatedAt: v.optional(v.number()),
  })
    .index("by_request_id", ["requestId"])
    .index("by_access_token_hash", ["accessTokenHash"])
    .index("by_admin_token_hash", ["adminTokenHash"]),

  mvpRequestMessages: defineTable({
    requestId: v.string(),
    sender: v.union(v.literal("system"), v.literal("visitor"), v.literal("owner")),
    text: v.string(),
    pdfUrl: v.optional(v.string()),
    demoUrl: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_request_id", ["requestId"]),
});
