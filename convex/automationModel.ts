import { v } from "convex/values";

export const automationPhase = v.union(
  v.literal("queued"), v.literal("generating"), v.literal("review"),
  v.literal("revision_queued"), v.literal("revising"), v.literal("complete"), v.literal("failed"),
);
export const jobStatus = v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("failed"));
export const workStage = v.union(v.literal("designing"), v.literal("checking"), v.literal("publishing"));
export const jobKind = v.union(v.literal("initial"), v.literal("revision"));
export const demoId = v.union(v.literal("1"), v.literal("2"), v.literal("3"));
export const demoOption = v.object({ id: demoId, title: v.string(), demoUrl: v.string() });
export const sourceVariant = v.object({ id: demoId, storageId: v.id("_storage") });
export const hostingOption = v.union(v.literal("cloudflare"), v.literal("hostiman"));
export const purchaseOption = v.union(v.literal("source"), v.literal("source_and_setup"));
export const offerVariant = v.union(v.literal("standard"), v.literal("budget"));
export const clientEvent = v.union(
  v.literal("source_purchase_requested"),
  v.literal("offer_purchase_requested"), v.literal("demo_selected"),
  v.literal("viewed"), v.literal("opened_pdf"), v.literal("opened_demo"),
  v.literal("revision_requested"), v.literal("accepted"), v.literal("development_requested"),
  v.literal("checkout_started"), v.literal("payment_succeeded"), v.literal("source_downloaded"),
  v.literal("request_received"), v.literal("generation_started"),
  v.literal("result_ready"), v.literal("generation_failed"),
  v.literal("delivery_failed"), v.literal("messenger_connected"),
);
export const automationSummary = v.object({
  phase: automationPhase,
  progress: v.optional(v.object({ stage: v.union(workStage, v.literal("queued"), v.literal("ready"), v.literal("failed")), queuedAt: v.number(), startedAt: v.optional(v.number()), heartbeatAt: v.optional(v.number()), serverTime: v.number() })),
  revisionUsed: v.boolean(),
  revisionCount: v.number(),
  revisionLimit: v.number(),
  canRevise: v.boolean(),
  canBuy: v.boolean(),
  purchaseContact: v.optional(v.object({ method: v.union(v.literal("telegram"), v.literal("email"), v.literal("max")), value: v.string() })),
  accepted: v.boolean(),
  paid: v.boolean(),
  developmentRequested: v.boolean(),
  sourcePurchaseRequested: v.boolean(),
  offerRequestKeys: v.array(v.string()),
  demoOptions: v.array(demoOption),
  selectedDemoId: v.optional(demoId),
  telegramBotUsername: v.optional(v.string()),
  maxBotUsername: v.optional(v.string()),
  messengerConnected: v.optional(v.boolean()),
});

type ReviewState = { phase: string; revisionUsed: boolean; revisionCount?: number; accepted: boolean; paid?: boolean; demoOptions?: { id: string }[]; demoUrl?: string; sourceStorageId?: unknown };

export function revisionCount(state: ReviewState) {
  return state.revisionCount ?? (state.revisionUsed ? 1 : 0);
}

export function canRequestRevision(state: ReviewState) {
  if (state.revisionCount === undefined) return state.phase === "review" && !state.revisionUsed && !state.accepted;
  return ["review", "failed"].includes(state.phase) && state.revisionCount < 2 && !state.paid && Boolean(state.demoOptions?.length) && state.demoOptions!.length < 3;
}

export function canPurchase(state: ReviewState) {
  return Boolean(state.demoOptions?.length || state.demoUrl || state.sourceStorageId) && !["queued", "generating"].includes(state.phase);
}
