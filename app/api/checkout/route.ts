// The user picked a top-up amount. Hand back a Stripe Checkout URL; the
// balance is credited when Stripe confirms the payment (see lib/stripe.ts).
import { NextResponse } from 'next/server'
import { isBlocked } from '@/lib/blocks'
import { TOP_UP_USD } from '@/lib/prices'
import { readJson } from '@/lib/route'
import { readSession } from '@/lib/session'
import { cardsEnabled, createCheckout } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out', message: 'Please sign in again' }, { status: 401 })
  if (await isBlocked('sub', session.sub)) return NextResponse.json({ ok: false, code: 'blocked', message: 'This account has been suspended' }, { status: 403 })
  if (!cardsEnabled()) return NextResponse.json({ ok: false, code: 'not_configured', message: 'Card payments are not set up on this server yet' })
  const { usd } = await readJson<{ usd?: number }>(req)
  const amount = Number(usd)
  if (!(TOP_UP_USD as readonly number[]).includes(amount)) {
    return NextResponse.json({ ok: false, code: 'invalid', message: 'Pick one of the amounts shown' })
  }
  const url = await createCheckout(session, amount * 100)
  if (!url) return NextResponse.json({ ok: false, code: 'failed', message: 'Could not open the payment page. Try again in a minute' })
  return NextResponse.json({ ok: true, data: { url } })
}
