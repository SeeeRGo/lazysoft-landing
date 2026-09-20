import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { enqueueInitial, event } from "./automation";

const contactMethod = v.union(v.literal("telegram"), v.literal("email"), v.literal("max"), v.literal("none"));
const requestStatus = v.union(
  v.literal("received"),
  v.literal("in_progress"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("closed"),
);
const source = v.object({
  utmSource: v.string(),
  utmMedium: v.optional(v.string()),
  utmCampaign: v.string(),
  utmContent: v.string(),
  utmTerm: v.string(),
  referrer: v.string(),
});
const message = v.object({
  _id: v.id("mvpRequestMessages"),
  _creationTime: v.number(),
  sender: v.union(v.literal("system"), v.literal("visitor"), v.literal("owner")),
  text: v.string(),
  pdfUrl: v.optional(v.string()),
  demoUrl: v.optional(v.string()),
  createdAt: v.number(),
});
const visitorThread = v.object({
  requestId: v.string(),
  idea: v.string(),
  status: requestStatus,
  receivedAt: v.number(),
  updatedAt: v.number(),
  messages: v.array(message),
});
const adminThread = v.object({
  requestId: v.string(),
  idea: v.string(),
  contactMethod,
  contact: v.string(),
  source,
  status: requestStatus,
  receivedAt: v.number(),
  updatedAt: v.number(),
  clientNotificationPending: v.boolean(),
  clientNotificationJobId: v.optional(v.id("requestJobs")),
  clientNotifiedAt: v.optional(v.number()),
  messages: v.array(message),
});

function publicMessage(row: {
  _id: Id<"mvpRequestMessages">;
  _creationTime: number;
  sender: "system" | "visitor" | "owner";
  text: string;
  pdfUrl?: string;
  demoUrl?: string;
  createdAt: number;
}) {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    sender: row.sender,
    text: row.text,
    ...(row.pdfUrl ? { pdfUrl: row.pdfUrl } : {}),
    ...(row.demoUrl ? { demoUrl: row.demoUrl } : {}),
    createdAt: row.createdAt,
  };
}

export const store = internalMutation({
  args: {
    requestId: v.string(),
    idea: v.string(),
    contactMethod,
    contact: v.string(),
    source,
    receivedAt: v.number(),
    accessTokenHash: v.optional(v.string()),
    adminTokenHash: v.optional(v.string()),
    deliveryTokenCiphertext: v.optional(v.string()),
    ownerNotificationText: v.optional(v.string()),
    requestType: v.optional(v.union(v.literal("mvp"), v.literal("crm"), v.literal("mobile"))),
  },
  returns: v.object({ created: v.boolean(), requestId: v.string() }),
  handler: async (ctx, args) => {
    if (args.accessTokenHash) {
      const prior = await ctx.db.query("mvpRequests").withIndex("by_access_token_hash", q => q.eq("accessTokenHash", args.accessTokenHash)).unique();
      if (prior) return { created: false, requestId: prior.requestId };
    }
    const existing = await ctx.db
      .query("mvpRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (existing) return { created: false, requestId: existing.requestId };
    const { ownerNotificationText, ...record } = args;
    await ctx.db.insert("mvpRequests", {
      ...record,
      status: "received",
      updatedAt: args.receivedAt,
    });
    if (args.accessTokenHash && args.adminTokenHash) {
      await ctx.db.insert("mvpRequestMessages", {
        requestId: args.requestId,
        sender: "system",
        text: "Заявка получена. Здесь появятся результат и уточняющие вопросы по вашей идее.",
        createdAt: args.receivedAt,
      });
    }
    if (process.env.REQUEST_AUTOMATION_ENABLED === "true" && args.requestType === "mvp" && args.accessTokenHash && args.adminTokenHash) {
      await enqueueInitial(ctx, args.requestId);
    }
    if (ownerNotificationText) await event(ctx, args.requestId, "request_received", "once", ownerNotificationText.slice(0, 3800));
    return { created: true, requestId: args.requestId };
  },
});

export const getVisitorThread = internalQuery({
  args: { accessTokenHash: v.string() },
  returns: v.union(v.null(), visitorThread),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("mvpRequests")
      .withIndex("by_access_token_hash", (q) => q.eq("accessTokenHash", args.accessTokenHash))
      .unique();
    if (!request) return null;
    const messages = await ctx.db
      .query("mvpRequestMessages")
      .withIndex("by_request_id", (q) => q.eq("requestId", request.requestId))
      .order("asc")
      .take(100);
    return {
      requestId: request.requestId,
      idea: request.idea,
      status: request.status ?? "received",
      receivedAt: request.receivedAt,
      updatedAt: request.updatedAt ?? request.receivedAt,
      messages: await Promise.all(messages.map(async row => ({ ...publicMessage(row), ...(row.pdfStorageId ? { pdfUrl: (await ctx.storage.getUrl(row.pdfStorageId)) ?? undefined } : {}) }))),
    };
  },
});

export const markClientNotified = internalMutation({
  args: { adminTokenHash: v.string(), jobId: v.id("requestJobs"), createdAt: v.number() },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const request = await ctx.db.query("mvpRequests").withIndex("by_admin_token_hash", q => q.eq("adminTokenHash", args.adminTokenHash)).unique();
    if (!request) return { ok: false, error: "Заявка не найдена" };
    if (request.contactMethod === "none") return { ok: false, error: "Контакт клиента не указан" };
    if (request.clientNotificationJobId !== args.jobId) return { ok: false, error: "Версия заявки уже изменилась. Обновите страницу" };
    if (request.clientNotifiedAt) return { ok: true };
    await ctx.db.patch(request._id, { clientNotifiedAt: args.createdAt, updatedAt: args.createdAt });
    return { ok: true };
  },
});

export const addVisitorMessage = internalMutation({
  args: { accessTokenHash: v.string(), text: v.string(), createdAt: v.number() },
  returns: v.object({ sent: v.boolean(), requestId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("mvpRequests")
      .withIndex("by_access_token_hash", (q) => q.eq("accessTokenHash", args.accessTokenHash))
      .unique();
    if (!request) return { sent: false };
    await ctx.db.insert("mvpRequestMessages", {
      requestId: request.requestId,
      sender: "visitor",
      text: args.text,
      createdAt: args.createdAt,
    });
    await ctx.db.patch(request._id, { updatedAt: args.createdAt });
    return { sent: true, requestId: request.requestId };
  },
});

export const getAdminThread = internalQuery({
  args: { adminTokenHash: v.string() },
  returns: v.union(v.null(), adminThread),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("mvpRequests")
      .withIndex("by_admin_token_hash", (q) => q.eq("adminTokenHash", args.adminTokenHash))
      .unique();
    if (!request) return null;
    const messages = await ctx.db
      .query("mvpRequestMessages")
      .withIndex("by_request_id", (q) => q.eq("requestId", request.requestId))
      .order("asc")
      .take(100);
    return {
      requestId: request.requestId,
      idea: request.idea,
      contactMethod: request.contactMethod,
      contact: request.contact,
      source: request.source,
      status: request.status ?? "received",
      receivedAt: request.receivedAt,
      updatedAt: request.updatedAt ?? request.receivedAt,
      clientNotificationPending: request.contactMethod !== "none" && Boolean(request.clientNotificationJobId) && !request.clientNotifiedAt,
      ...(request.clientNotificationJobId ? { clientNotificationJobId: request.clientNotificationJobId } : {}),
      ...(request.clientNotifiedAt ? { clientNotifiedAt: request.clientNotifiedAt } : {}),
      messages: await Promise.all(messages.map(async row => ({ ...publicMessage(row), ...(row.pdfStorageId ? { pdfUrl: (await ctx.storage.getUrl(row.pdfStorageId)) ?? undefined } : {}) }))),
    };
  },
});

export const addOwnerMessage = internalMutation({
  args: {
    adminTokenHash: v.string(),
    text: v.string(),
    pdfUrl: v.optional(v.string()),
    demoUrl: v.optional(v.string()),
    status: requestStatus,
    createdAt: v.number(),
  },
  returns: v.object({ sent: v.boolean() }),
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("mvpRequests")
      .withIndex("by_admin_token_hash", (q) => q.eq("adminTokenHash", args.adminTokenHash))
      .unique();
    if (!request) return { sent: false };
    await ctx.db.insert("mvpRequestMessages", {
      requestId: request.requestId,
      sender: "owner",
      text: args.text,
      ...(args.pdfUrl ? { pdfUrl: args.pdfUrl } : {}),
      ...(args.demoUrl ? { demoUrl: args.demoUrl } : {}),
      createdAt: args.createdAt,
    });
    await ctx.db.patch(request._id, { status: args.status, updatedAt: args.createdAt });
    return { sent: true };
  },
});
