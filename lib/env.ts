// Every knob the app reads. Nothing customer-facing names the data backend.
export const APP_NAME = 'Job Hunter'
export const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
export const SESSION_SECRET = process.env.SESSION_SECRET ?? ''

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
export const GOOGLE_REDIRECT_URI = `${APP_URL}/api/auth/google/callback`

// The data backend (Vaaya). One operator key pays for every backend call:
// resume reading, contacts, email lookups, drafts, and job search unless
// JSEARCH_API_KEY is set. Users never see it.
export const VAAYA_URL = (process.env.VAAYA_URL || 'https://vaaya.ai').replace(/\/$/, '')
export const VAAYA_API_KEY = process.env.VAAYA_API_KEY ?? ''
// Managing customers (create, fund, mint access) needs the account's primary,
// unrestricted key; a capped sub-key is refused with 403. Kept separate so the
// everyday operator key can stay capped. Falls back to VAAYA_API_KEY.
export const OWNER_API_KEY = process.env.VAAYA_OWNER_KEY || VAAYA_API_KEY

// Optional: your own OpenWeb Ninja key for JSearch. Set, job search calls
// JSearch's direct API with it. Unset, job search goes through Vaaya on
// VAAYA_API_KEY.
export const JSEARCH_API_KEY = process.env.JSEARCH_API_KEY ?? ''

// Managed customers: one Vaaya identity + x402 wallet per signed-in user, so
// spend is attributed per person instead of pooled on the operator key. Off
// by default; every path here degrades to the operator key.
export const CUSTOMERS_ENABLED = process.env.VAAYA_CUSTOMERS_ENABLED === 'true'
// Lifetime cap on what one customer wallet may ever be funded with, in cents.
export const CUSTOMER_BUDGET_CENTS = Math.round(Number(process.env.CUSTOMER_BUDGET_CENTS || 500))
// What the owner key moves into a new wallet before its first call, in cents.
export const CUSTOMER_WELCOME_CENTS = Math.round(Number(process.env.CUSTOMER_WELCOME_CENTS || 50))

// Money. Balances are integer US cents. New accounts start with this much
// (none by default).
export const START_CREDIT_CENTS = Math.max(0, Math.round(Number(process.env.START_CREDIT_CENTS || 0)))
// Free resume reads per account per day. Each one is a model call on the
// operator's key.
export const PARSES_PER_DAY = Math.max(1, Math.round(Number(process.env.PARSES_PER_DAY || 10)))
// Searches that find nothing, per account per day. They cost the user nothing
// but still make job search calls on the operator's key.
export const EMPTY_SEARCHES_PER_DAY = Math.max(1, Math.round(Number(process.env.EMPTY_SEARCHES_PER_DAY || 10)))

// Card top-ups through the operator's own Stripe account. Without a secret
// key the add-funds sheet says card payments are not set up.
export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? ''
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? ''

export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ''

export function missingConfig(): string[] {
  const out: string[] = []
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) out.push('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET')
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) out.push('SESSION_SECRET')
  if (!VAAYA_API_KEY) out.push('VAAYA_API_KEY')
  if (!process.env.BLOB_READ_WRITE_TOKEN) out.push('BLOB_READ_WRITE_TOKEN')
  return out
}
