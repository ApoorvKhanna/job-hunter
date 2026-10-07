// Card top-ups through the operator's own Stripe account, over plain REST so
// the app carries no Stripe SDK. A Checkout Session is created per top-up,
// and the balance is credited when Stripe confirms the payment: by the
// webhook, and again on the return page in case the webhook is slow. Both
// paths go through creditTopUp, which credits a session once.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { APP_NAME, APP_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from './env'
import { creditTopUp, getAccount } from './ledger'

const API = 'https://api.stripe.com/v1'

// Both keys, or top-ups stay off: without the webhook secret every webhook
// would be rejected and payments would credit only via the return page.
export const cardsEnabled = () => !!STRIPE_SECRET_KEY && !!STRIPE_WEBHOOK_SECRET

/** Tags this app's sessions, so other payments on the same Stripe account are
 *  never mistaken for a top-up. */
const APP_TAG = 'job-hunter'

export interface CheckoutSession {
  id: string
  url?: string | null
  payment_status: 'paid' | 'unpaid' | 'no_payment_required'
  amount_total: number | null
  currency: string | null
  client_reference_id: string | null
  metadata?: Record<string, string> | null
}

async function stripe<T>(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  })
  if (!res.ok) {
    console.error('[stripe]', method, path, res.status, (await res.text()).slice(0, 300))
    return null
  }
  return (await res.json()) as T
}

/** A hosted Checkout page for one top-up. Returns its URL, or null. */
export async function createCheckout(who: { sub: string; email: string }, cents: number): Promise<string | null> {
  const session = await stripe<CheckoutSession>('POST', '/checkout/sessions', {
    mode: 'payment',
    success_url: `${APP_URL}/app?topup={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/app`,
    client_reference_id: who.sub,
    customer_email: who.email,
    'metadata[sub]': who.sub,
    'metadata[app]': APP_TAG,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': `${APP_NAME} balance`,
  })
  return session?.url ?? null
}

export async function getCheckout(id: string): Promise<CheckoutSession | null> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return null
  return stripe<CheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(id)}`)
}

/** The account a session belongs to, if it is one of this app's top-ups. */
export function topUpOwner(session: CheckoutSession): string | null {
  return session.metadata?.app === APP_TAG && session.metadata?.sub ? session.metadata.sub : null
}

/** Credit a paid top-up session to the account that started it. Safe to
 *  repeat. Sessions that are not this app's, or not paid in USD, are ignored. */
export async function settleCheckout(session: CheckoutSession): Promise<{ sub: string; cents: number; credited: boolean } | null> {
  const sub = topUpOwner(session)
  if (!sub || session.payment_status !== 'paid' || session.currency !== 'usd' || !session.amount_total) return null
  if (!(await getAccount(sub))) {
    // Nothing to credit; retrying will not change that.
    console.error('[topup] no account for a paid session', JSON.stringify({ sub, session: session.id }))
    return null
  }
  const { credited } = await creditTopUp(sub, session.id, session.amount_total)
  if (credited) console.log('[topup]', JSON.stringify({ sub, cents: session.amount_total, session: session.id }))
  return { sub, cents: session.amount_total, credited }
}

/** Check a webhook's Stripe-Signature header against the endpoint secret. */
export function verifyWebhook(payload: string, header: string | null, secret: string, toleranceSec = 300): boolean {
  if (!header || !secret) return false
  const parts = header.split(',').map((p) => p.split('=') as [string, string])
  const t = parts.find(([k]) => k === 't')?.[1]
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!t || sigs.length === 0) return false
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex'))
  return sigs.some((s) => {
    const got = Buffer.from(s)
    return got.length === expected.length && timingSafeEqual(got, expected)
  })
}
