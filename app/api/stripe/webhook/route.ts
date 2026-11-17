// Stripe calls this when a Checkout payment completes. Point a webhook
// endpoint at https://<host>/api/stripe/webhook for the events
// checkout.session.completed and checkout.session.async_payment_succeeded,
// and put its signing secret in STRIPE_WEBHOOK_SECRET.
import { NextResponse } from 'next/server'
import { STRIPE_WEBHOOK_SECRET } from '@/lib/env'
import { type CheckoutSession, settleCheckout, verifyWebhook } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

const CREDIT_ON = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])

export async function POST(req: Request) {
  const payload = await req.text()
  if (!verifyWebhook(payload, req.headers.get('stripe-signature'), STRIPE_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, code: 'bad_signature' }, { status: 400 })
  }
  const event = JSON.parse(payload) as { type?: string; data?: { object?: CheckoutSession } }
  if (event.type && CREDIT_ON.has(event.type) && event.data?.object) {
    try {
      await settleCheckout(event.data.object)
    } catch (err) {
      // A 500 makes Stripe retry, which is what we want for a ledger hiccup.
      console.error('[topup] webhook credit failed', err)
      return NextResponse.json({ ok: false }, { status: 500 })
    }
  }
  return NextResponse.json({ received: true })
}
