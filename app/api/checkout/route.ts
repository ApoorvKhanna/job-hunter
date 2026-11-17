// Open a Stripe Checkout for the signed-in user, in their account's currency.
// Two kinds: a plain top-up (one of the amounts in TOP_UPS), or exactly what
// a review still needs after the balance is applied. Either way the payment
// lands as balance; the review is then debited from it like any other step.
import { NextResponse } from 'next/server'
import { isBlocked } from '@/lib/blocks'
import { ensureAccount } from '@/lib/ledger'
import { MIN_CHECKOUT, REVIEW_PRICE, TOP_UPS, money } from '@/lib/prices'
import { getReview } from '@/lib/review-store'
import { readJson } from '@/lib/route'
import { readSession } from '@/lib/session'
import { createCheckout, returnPath, stripeEnabled } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out', message: 'Please sign in again.' }, { status: 401 })
  if (await isBlocked('sub', session.sub)) return NextResponse.json({ ok: false, code: 'blocked', message: 'This account has been suspended.' }, { status: 403 })
  if (!stripeEnabled()) return NextResponse.json({ ok: false, code: 'not_configured', message: 'Payments are not switched on yet. Try again later.' })
  const body = await readJson<{ amount?: number; review_id?: string; return?: string }>(req)
  const account = await ensureAccount(session)
  const c = account.currency

  let amount: number
  let label: string
  let reviewId: string | undefined
  if (body.review_id) {
    const review = await getReview(session.sub, String(body.review_id))
    if (!review || (review.status !== 'draft' && review.status !== 'failed')) {
      return NextResponse.json({ ok: false, code: 'invalid', message: 'That review has already started. Open it from your saved results.' })
    }
    const short = REVIEW_PRICE[c] - account.balance
    if (short <= 0) return NextResponse.json({ ok: false, code: 'covered', message: 'Your balance already covers the review.' })
    amount = Math.max(short, MIN_CHECKOUT[c])
    label = 'Resume and profile review'
    reviewId = review.id
  } else {
    const units = Number(body.amount)
    if (!TOP_UPS[c].includes(units)) return NextResponse.json({ ok: false, code: 'invalid', message: 'Pick one of the amounts shown.' })
    amount = units * 100
    label = `${money(amount, c)} credits`
  }

  const url = await createCheckout(session, c, amount, {
    path: returnPath(body.return, reviewId),
    label,
    purpose: reviewId ? 'review' : 'credits',
    reviewId,
  })
  if (!url) return NextResponse.json({ ok: false, code: 'failed', message: 'Could not open the payment page. Try again in a minute.' })
  return NextResponse.json({ ok: true, data: { url } })
}
