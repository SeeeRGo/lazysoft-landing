import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const contactMethod = v.union(v.literal("telegram"), v.literal("email"), v.literal("max"));
const requestStatus = v.union(
  v.literal("received"),
  v.literal("in_progress"),
  v.literal("ready"),
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
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mvpRequests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (existing) return { created: false };
    await ctx.db.insert("mvpRequests", {
      ...args,
      status: "received",
      updatedAt: args.receivedAt,
    });
    if (args.accessTokenHash && args.adminTokenHash) {
      await ctx.db.insert("mvpRequestMessages", {
        requestId: args.requestId,
        sender: "system",
        text: "Заявка получена. Здесь появятся ТЗ, демо интерфейса и уточняющие вопросы.",
        createdAt: args.receivedAt,
      });
    }
    return { created: true };
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
      messages: messages.map(publicMessage),
    };
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
      messages: messages.map(publicMessage),
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
