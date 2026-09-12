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

// Managed customers: one Vaaya identity + x402 wallet per signed-in user, so
// spend is attributed per person instead of pooled on the operator key. Off
// by default: the backend returns 503 customers_not_enabled until its owner
// rolls the feature out, and every path here degrades to the operator key.
export const CUSTOMERS_ENABLED = process.env.VAAYA_CUSTOMERS_ENABLED === 'true'
// Lifetime cap on what one customer wallet may ever be funded with, in cents.
export const CUSTOMER_BUDGET_CENTS = Math.round(Number(process.env.CUSTOMER_BUDGET_CENTS ?? 500))
// First funding, in cents. Mirrors the ₹49 welcome at the app's ₹1 ≈ 1¢ mapping.
export const CUSTOMER_WELCOME_CENTS = Math.round(Number(process.env.CUSTOMER_WELCOME_CENTS ?? 49))

// Money. Balances are integer paise. Every new account starts with this.
export const START_CREDIT_PAISE = Math.round(Number(process.env.START_CREDIT_INR ?? 49) * 100)
export const UPI_ID = process.env.UPI_ID ?? ''
export const UPI_NAME = process.env.UPI_NAME ?? APP_NAME
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ''

export function missingConfig(): string[] {
  const out: string[] = []
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) out.push('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET')
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) out.push('SESSION_SECRET')
  if (!PROVIDER_API_KEY) out.push('PROVIDER_API_KEY')
  if (!process.env.BLOB_READ_WRITE_TOKEN) out.push('BLOB_READ_WRITE_TOKEN')
  return out
}
