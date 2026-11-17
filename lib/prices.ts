// What the user pays, in minor units of their account's currency: paise for
// INR, cents for USD. An account's currency is fixed when it is created from
// the country it signs up in: India pays in rupees (UPI or card), everyone
// else in US dollars (card). Each step is debited only when it succeeds.
export type Currency = 'inr' | 'usd'
export type Step = 'parse' | 'jobs' | 'contact' | 'email' | 'draft'

export const PRICES: Record<Currency, Record<Step, number>> = {
  // Reading a resume is free, capped per day.
  inr: { parse: 0, jobs: 4900, contact: 600, email: 2000, draft: 200 },
  // Dollar prices follow one fixed ratio, ₹499 = $9 (about ₹55 to the
  // dollar), rounded to the cent. Not the market rate, on purpose.
  usd: { parse: 0, jobs: 88, contact: 11, email: 36, draft: 4 },
}

/** The resume + profile review: one price, everything included. */
export const REVIEW_PRICE: Record<Currency, number> = { inr: 47900, usd: 900 }

/** Credit a new account starts with. */
export const WELCOME: Record<Currency, number> = { inr: 4500, usd: 81 }

/** Top-ups offered in the add-credits sheet, in whole rupees / dollars. */
export const TOP_UPS: Record<Currency, readonly number[]> = { inr: [149, 499, 999], usd: [5, 10, 20] }

/** Smallest card / UPI payment we open a checkout for, in minor units. */
export const MIN_CHECKOUT: Record<Currency, number> = { inr: 5000, usd: 100 }

/** Free resume reads per account per day. */
export const PARSES_PER_DAY = 10

export function priceOf(step: Step, currency: Currency): number {
  return PRICES[currency][step]
}

/** "₹40", "₹4.50", "$9", "$0.75" */
export function money(minor: number, currency: Currency): string {
  const units = minor / 100
  const sym = currency === 'inr' ? '₹' : '$'
  if (Number.isInteger(units)) return `${sym}${units.toLocaleString(currency === 'inr' ? 'en-IN' : 'en-US')}`
  return `${sym}${units.toFixed(2)}`
}

/** A step's price for a button label: "₹40", or "Free". */
export function priceLabel(minor: number, currency: Currency): string {
  return minor > 0 ? money(minor, currency) : 'Free'
}

export function inr(paise: number): string {
  return money(paise, 'inr')
}

export function currencyForCountry(code: string | null | undefined, fallback: Currency = 'inr'): Currency {
  if (!code) return fallback
  return code.toUpperCase() === 'IN' ? 'inr' : 'usd'
}

/** Manual UPI (QR + UTR) amounts, only shown while Stripe is not set up. */
export const RECHARGE_OPTIONS_INR = TOP_UPS.inr
