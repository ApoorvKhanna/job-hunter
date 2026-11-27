// Top-ups through the operator's Stripe account, over plain REST so the app
// carries no Stripe SDK. One Checkout Session per top-up, in the account's
// currency: rupee accounts see UPI and cards, dollar accounts see cards (and
// whatever else the Stripe Dashboard turns on). Payment methods are NOT
// listed here on purpose: Checkout shows what the Dashboard enables, so
// switching UPI on is a Dashboard toggle, not a deploy.
//
// The balance is credited when Stripe confirms the payment: by the webhook,
// and again on the return page in case the webhook is slow. Both paths go
// through creditTopUp, which credits a session once.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { APP_NAME, APP_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, UPI_ID, UPI_NAME } from './env'
import { creditPack, creditTopUp, getAccount } from './ledger'
import { type Currency, money, packById, packLabel } from './prices'

const API = 'https://api.stripe.com/v1'

// Both keys, or Stripe stays off: without the webhook secret every webhook
// would be rejected and payments would credit only via the return page.
export const stripeEnabled = () => !!STRIPE_SECRET_KEY && !!STRIPE_WEBHOOK_SECRET

/** What the add-credits sheet can offer, for the client. */
export function payConfig(): { stripe: boolean; upi: { id: string; name: string } } {
  return { stripe: stripeEnabled(), upi: { id: UPI_ID, name: UPI_NAME } }
}

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

/** Where Stripe sends the user back. Only our own pages. */
export type ReturnTo = 'app' | 'jobs' | 'review' | 'saved'
export function returnPath(to: string | undefined, reviewId?: string): string {
  const base = to === 'jobs' || to === 'review' || to === 'saved' ? `/${to}` : '/app'
  return reviewId && base === '/review' ? `${base}?review=${encodeURIComponent(reviewId)}` : base
}

/** A hosted Checkout page for one top-up. Returns its URL, or null. */
export async function createCheckout(
  who: { sub: string; email: string },
  currency: Currency,
  amount: number,
  opts: { path: string; label: string; purpose: 'pack' | 'review'; reviewId?: string; packId?: string },
): Promise<string | null> {
  const join = opts.path.includes('?') ? '&' : '?'
  const session = await stripe<CheckoutSession>('POST', '/checkout/sessions', {
    mode: 'payment',
    success_url: `${APP_URL}${opts.path}${join}topup={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}${opts.path}`,
    client_reference_id: who.sub,
    customer_email: who.email,
    'metadata[sub]': who.sub,
    'metadata[app]': APP_TAG,
    'metadata[purpose]': opts.purpose,
    ...(opts.reviewId ? { 'metadata[review]': opts.reviewId } : {}),
    ...(opts.packId ? { 'metadata[pack]': opts.packId } : {}),
    'payment_intent_data[description]': `${APP_NAME}: ${opts.label}`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': currency,
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': opts.label,
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
 *  repeat. Sessions that are not this app's, unpaid, or in a currency other
 *  than the account's are ignored. */
export async function settleCheckout(session: CheckoutSession): Promise<{ sub: string; amount: number; currency: Currency; credited: boolean; what: string } | null> {
  const sub = topUpOwner(session)
  if (!sub || session.payment_status !== 'paid' || !session.amount_total) return null
  const account = await getAccount(sub)
  if (!account) {
    // Nothing to credit; retrying will not change that.
    console.error('[topup] no account for a paid session', JSON.stringify({ sub, session: session.id }))
    return null
  }
  if (session.currency !== account.currency) {
    console.error('[topup] currency mismatch, not credited', JSON.stringify({ sub, session: session.id, paid: session.currency, account: account.currency }))
    return null
  }
  // A pack: emails + deep searches, at exactly the pack's price.
  if (session.metadata?.purpose === 'pack') {
    const pack = packById(session.metadata.pack)
    if (!pack || pack.price[account.currency] !== session.amount_total) {
      console.error('[topup] pack does not match what was paid, not credited', JSON.stringify({ sub, session: session.id, pack: session.metadata.pack, paid: session.amount_total }))
      return null
    }
    const { credited } = await creditPack(sub, session.id, pack, session.amount_total)
    if (credited) console.log('[topup] pack', JSON.stringify({ sub, pack: pack.id, amount: session.amount_total, currency: account.currency, session: session.id }))
    return { sub, amount: session.amount_total, currency: account.currency, credited, what: packLabel(pack) }
  }
  // Money: a review payment, or a top-up opened before packs existed.
  const note = account.currency === 'inr' ? 'Top-up (UPI or card)' : 'Top-up (card)'
  const { credited } = await creditTopUp(sub, session.id, session.amount_total, note)
  if (credited) console.log('[topup]', JSON.stringify({ sub, amount: session.amount_total, currency: account.currency, session: session.id }))
  return { sub, amount: session.amount_total, currency: account.currency, credited, what: money(session.amount_total, account.currency) }
}

/** Back from Stripe on one of our pages: credit now rather than wait for the
 *  webhook. Only the account that started the checkout can settle it.
 *  Returns the line to show, or null when there is nothing to say. */
export async function settleReturn(sub: string, topup: string | undefined): Promise<string | null> {
  if (!topup || !stripeEnabled()) return null
  const checkout = await getCheckout(topup)
  if (!checkout || topUpOwner(checkout) !== sub) return null
  const settled = await settleCheckout(checkout).catch((err) => {
    console.error('[topup] return credit failed', err)
    return null
  })
  return settled ? `${settled.what} added to your account.` : 'Your payment is still processing. Your account updates when it clears.'
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
