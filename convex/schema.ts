import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { automationPhase, jobStatus, jobKind, clientEvent } from "./automationModel";

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
    requestType: v.optional(v.union(v.literal("mvp"), v.literal("crm"), v.literal("mobile"))),
    accessTokenHash: v.optional(v.string()),
    adminTokenHash: v.optional(v.string()),
    deliveryTokenCiphertext: v.optional(v.string()),
    telegramChatId: v.optional(v.string()),
    maxUserId: v.optional(v.string()),
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

  requestAutomations: defineTable({
    requestId: v.string(),
    phase: automationPhase,
    revisionUsed: v.boolean(),
    accepted: v.boolean(),
    paid: v.boolean(),
    developmentRequested: v.boolean(),
    sourceStorageId: v.optional(v.id("_storage")),
    pdfStorageId: v.optional(v.id("_storage")),
    demoUrl: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_request_id", ["requestId"]),

  requestJobs: defineTable({
    requestId: v.string(),
    kind: jobKind,
    status: jobStatus,
    instructions: v.string(),
    attempts: v.number(),
    availableAt: v.number(),
    leaseToken: v.optional(v.string()),
    leaseUntil: v.optional(v.number()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  }).index("by_status_and_available_at", ["status", "availableAt"])
    .index("by_status_and_lease_until", ["status", "leaseUntil"])
    .index("by_request_id", ["requestId"]),

  requestEvents: defineTable({
    requestId: v.string(),
    kind: clientEvent,
    dedupeKey: v.string(),
    text: v.string(),
    createdAt: v.number(),
    notifiedAt: v.optional(v.number()),
    attempts: v.number(),
  }).index("by_dedupe_key", ["dedupeKey"]),

  sourcePayments: defineTable({
    requestId: v.string(),
    receiptEmail: v.string(),
    status: v.union(v.literal("creating"), v.literal("pending"), v.literal("succeeded"), v.literal("canceled")),
    paymentId: v.optional(v.string()),
    confirmationUrl: v.optional(v.string()),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
  }).index("by_request_id", ["requestId"]).index("by_payment_id", ["paymentId"]),

  requestDeliveries: defineTable({
    requestId: v.string(),
    jobId: v.id("requestJobs"),
    status: v.union(v.literal("pending"), v.literal("sending"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    leaseUntil: v.optional(v.number()),
    sentAt: v.optional(v.number()),
  }).index("by_request_id", ["requestId"]),

  mvpRequestMessages: defineTable({
    requestId: v.string(),
    sender: v.union(v.literal("system"), v.literal("visitor"), v.literal("owner")),
    text: v.string(),
    pdfStorageId: v.optional(v.id("_storage")),
    pdfUrl: v.optional(v.string()),
    demoUrl: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_request_id", ["requestId"]),
});
