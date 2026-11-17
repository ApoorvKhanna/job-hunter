// Every knob the app reads. Nothing customer-facing names the data provider.
export const APP_NAME = 'Job Hunter'
export const APP_URL = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
export const SESSION_SECRET = process.env.SESSION_SECRET ?? ''

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
export const GOOGLE_REDIRECT_URI = `${APP_URL}/api/auth/google/callback`

// The data backend. One operator key; users never see it.
export const PROVIDER_URL = (process.env.PROVIDER_URL ?? 'https://vaaya.ai').replace(/\/$/, '')
export const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY ?? ''
// Managing customers (create, fund, mint access) needs the account's primary,
// unrestricted key; a capped sub-key is refused with 403. Kept separate so the
// everyday operator key can stay capped. Falls back to PROVIDER_API_KEY.
export const OWNER_API_KEY = process.env.VAAYA_OWNER_KEY || PROVIDER_API_KEY

// The job source. When set, jobs come from JSearch (OpenWeb Ninja's direct
// API) at a fraction of the per-job cost; unset, we fall back to the old
// vendor so the app keeps working.
export const JSEARCH_API_KEY = process.env.JSEARCH_API_KEY ?? ''
// Jobs go through the provider (openwebninja/jsearch on Vaaya) first, so every
// paid call settles on one ledger. The direct key above is only the fallback
// while the provider has no key of its own; remove it once the provider path
// is confirmed live. `JOBS_VIA_PROVIDER=false` forces the direct path.
export const JOBS_VIA_PROVIDER = process.env.JOBS_VIA_PROVIDER !== 'false'

// Managed customers: one Vaaya identity + x402 wallet per signed-in user, so
// spend is attributed per person instead of pooled on the operator key. Off
// by default: the backend returns 503 customers_not_enabled until its owner
// rolls the feature out, and every path here degrades to the operator key.
export const CUSTOMERS_ENABLED = process.env.VAAYA_CUSTOMERS_ENABLED === 'true'
// Lifetime cap on what one customer wallet may ever be funded with, in cents.
export const CUSTOMER_BUDGET_CENTS = Math.round(Number(process.env.CUSTOMER_BUDGET_CENTS ?? 500))
// First funding, in cents. Mirrors the welcome credit at the app's ₹1 ≈ 1¢ mapping.
export const CUSTOMER_WELCOME_CENTS = Math.round(Number(process.env.CUSTOMER_WELCOME_CENTS ?? 49))

// Money. Prices, the welcome credit and top-up amounts live in lib/prices.ts.
// Balances are integer minor units (paise or cents) of the account's currency.
// Where we cannot tell the visitor's country (local dev), new accounts use this.
export const DEFAULT_CURRENCY: 'inr' | 'usd' = process.env.DEFAULT_CURRENCY === 'usd' ? 'usd' : 'inr'

// Stripe: card and UPI top-ups for every account. Both keys, or Stripe stays
// off and India falls back to the manual UPI QR below.
export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? ''
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? ''

// Manual UPI (pay the QR, type the UTR). Only offered while Stripe is off.
export const UPI_ID = process.env.UPI_ID ?? ''
// Recharges up to this much per account per day are credited the moment the
// UTR is entered (and reviewed later on /admin); larger ones wait for approval.
export const AUTO_CREDIT_INR_PER_DAY = Math.round(Number(process.env.AUTO_CREDIT_INR_PER_DAY ?? 99))
export const UPI_NAME = process.env.UPI_NAME ?? APP_NAME

// The resume + profile review. A vision-capable model on the provider's
// router; it falls back to reading the text layout when images are refused.
export const REVIEW_MODEL = process.env.REVIEW_MODEL || 'anthropic/claude-sonnet-4.5'
// Optional. Lifts GitHub's 60-requests-an-hour limit for profile reads.
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? ''
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ''

export function missingConfig(): string[] {
  const out: string[] = []
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) out.push('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET')
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) out.push('SESSION_SECRET')
  if (!PROVIDER_API_KEY) out.push('PROVIDER_API_KEY')
  if (!process.env.BLOB_READ_WRITE_TOKEN) out.push('BLOB_READ_WRITE_TOKEN')
  return out
}
