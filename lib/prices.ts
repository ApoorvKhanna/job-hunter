// What people pay, and what is free. Money is in minor units of the
// account's currency: paise for INR, cents for USD. An account's currency is
// fixed when it is created from the country it signs up in: India pays in
// rupees (UPI or card), everyone else in US dollars (card).
//
// The job hunt has one price: the email. Reading a resume, searching,
// finding the people at a company and drafting the note are free within a
// daily allowance, so a new user sees the whole thing work before paying.
// The allowances bound what a non-paying account can cost us; the one
// expensive call (the deep job source, ~40¢ a call) is never free. Emails and
// deep searches come in packs. The review is priced on its own.
import { plural } from './format'

export type Currency = 'inr' | 'usd'
export type Step = 'parse' | 'jobs' | 'contact' | 'email' | 'draft'

/** Free things with a daily allowance. `preview` is the review's free scan. */
export type Allowance = 'parse' | 'jobs' | 'contact' | 'draft' | 'preview'

/** Per account, per rolling 24 hours. What each costs us, roughly: a resume
 *  read or a draft under 0.5¢, a search on the cheap source 1-4¢, the people
 *  at a company 2¢, a preview scan ~4¢. So a free account that uses every
 *  allowance costs about 30¢ a day, and a typical one-time visitor about 5¢.
 *  Anyone who has paid gets the larger allowance. */
export const DAILY: Record<'free' | 'paid', Record<Allowance, number>> = {
  free: { parse: 10, jobs: 3, contact: 5, draft: 5, preview: 1 },
  paid: { parse: 20, jobs: 15, contact: 30, draft: 60, preview: 3 },
}

/** Emails a new account starts with. Limited to one account per network
 *  (ipgate.ts), like the money welcome it replaces. */
export const WELCOME_EMAILS = 1

export type PackId = 's' | 'm' | 'l'
export interface Pack {
  id: PackId
  emails: number
  /** Deep searches: the pricier job source, for when the cheap one comes
   *  back thin. Sized so even a pack whose every deep search hits that
   *  source (~₹35 each) still covers its costs. */
  deep: number
  price: Record<Currency, number>
}

/** What the add-credits sheet sells. Packs never expire. */
export const PACKS: readonly Pack[] = [
  { id: 's', emails: 8, deep: 2, price: { inr: 14900, usd: 500 } },
  { id: 'm', emails: 30, deep: 8, price: { inr: 49900, usd: 1000 } },
  { id: 'l', emails: 70, deep: 20, price: { inr: 99900, usd: 2000 } },
]

export const packById = (id: unknown): Pack | null => PACKS.find((p) => p.id === id) ?? null

/** An email for accounts that hold money from before packs (paid top-ups,
 *  manual UPI, the old welcome credit) but no email credits. Dollar prices
 *  follow the fixed ₹499 = $9 ratio. */
export const LEGACY_EMAIL_PRICE: Record<Currency, number> = { inr: 2000, usd: 36 }

/** The resume + profile review: one price, everything included. */
export const REVIEW_PRICE: Record<Currency, number> = { inr: 47900, usd: 900 }

/** Smallest card / UPI payment we open a checkout for, in minor units. */
export const MIN_CHECKOUT: Record<Currency, number> = { inr: 5000, usd: 100 }

/** What an account can spend: money (older balances, and for the review),
 *  email credits and deep searches. */
export interface Wallet { balance: number; emails: number; deep: number }

/** "₹40", "₹4.50", "$9", "$0.75" */
export function money(minor: number, currency: Currency): string {
  const units = minor / 100
  const sym = currency === 'inr' ? '₹' : '$'
  if (Number.isInteger(units)) return `${sym}${units.toLocaleString(currency === 'inr' ? 'en-IN' : 'en-US')}`
  return `${sym}${units.toFixed(2)}`
}

export function inr(paise: number): string {
  return money(paise, 'inr')
}

/** "8 emails + 2 deep searches" */
export function packLabel(p: Pack): string {
  return `${plural(p.emails, 'email')} + ${plural(p.deep, 'deep search', 'deep searches')}`
}

export function currencyForCountry(code: string | null | undefined, fallback: Currency = 'inr'): Currency {
  if (!code) return fallback
  return code.toUpperCase() === 'IN' ? 'inr' : 'usd'
}

/** Manual UPI (QR + UTR) amounts, only shown while Stripe is not set up.
 *  These add money, which buys emails at the legacy price. */
export const RECHARGE_OPTIONS_INR = [149, 499, 999] as const
