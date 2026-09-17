// Keep the public landing and private offer on the same build-time prices.
export const isBudgetOffer = import.meta.env.PUBLIC_SITE_OFFER_VARIANT === "budget";
export const sourcePrice = isBudgetOffer ? 3000 : 5000;
export const setupPrice = isBudgetOffer ? 2000 : 3000;
export const totalPrice = sourcePrice + setupPrice;
export const price = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
