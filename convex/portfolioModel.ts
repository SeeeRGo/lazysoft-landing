import { v } from 'convex/values';
export const portfolioWork = v.object({
  id: v.string(), category: v.union(v.literal('covers'),v.literal('spreads'),v.literal('magazines'),v.literal('logos')),
  title: v.string(), description: v.string(), image: v.id('_storage'), document: v.optional(v.id('_storage')),
});
export const portfolioContent = v.object({ name: v.string(), headline: v.string(), about: v.string(), email: v.string(), telegram: v.string(), prices: v.string(), works: v.array(portfolioWork) });
