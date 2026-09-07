import { v } from "convex/values";

export const automationPhase = v.union(
  v.literal("queued"), v.literal("generating"), v.literal("review"),
  v.literal("revision_queued"), v.literal("revising"), v.literal("complete"), v.literal("failed"),
);
export const jobStatus = v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("failed"));
export const jobKind = v.union(v.literal("initial"), v.literal("revision"));
export const clientEvent = v.union(
  v.literal("source_purchase_requested"),
  v.literal("viewed"), v.literal("opened_pdf"), v.literal("opened_demo"),
  v.literal("revision_requested"), v.literal("accepted"), v.literal("development_requested"),
  v.literal("checkout_started"), v.literal("payment_succeeded"), v.literal("source_downloaded"),
  v.literal("result_ready"), v.literal("generation_failed"),
  v.literal("delivery_failed"), v.literal("messenger_connected"),
);
export const automationSummary = v.object({
  phase: automationPhase,
  revisionUsed: v.boolean(),
  accepted: v.boolean(),
  paid: v.boolean(),
  developmentRequested: v.boolean(),
  sourcePurchaseRequested: v.boolean(),
  telegramBotUsername: v.optional(v.string()),
  maxBotUsername: v.optional(v.string()),
  messengerConnected: v.optional(v.boolean()),
});

export function canRequestRevision(state: { phase: string; revisionUsed: boolean; accepted: boolean }) {
  return state.phase === "review" && !state.revisionUsed && !state.accepted;
}

export function canPurchase(state: { phase: string; accepted: boolean; revisionUsed: boolean }) {
  return state.phase === "complete" && (state.accepted || state.revisionUsed);
}
