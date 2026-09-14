// The user paid by UPI and typed the UTR. If the reference looks real, is
// unused, and the amount is inside the daily instant cap, the credit lands
// now and they get an email; otherwise it waits for an operator on /admin.
import { NextResponse } from 'next/server'
import { topUpCustomer } from '@/lib/customer-flow'
import { AUTO_CREDIT_INR_PER_DAY } from '@/lib/env'
import { addApproved, addPending, autoCreditedToday, ensureAccount } from '@/lib/ledger'
import { sendCreditEmail } from '@/lib/notify'
import { RECHARGE_OPTIONS_INR } from '@/lib/prices'
import { readJson } from '@/lib/route'
import { readSession } from '@/lib/session'
import { looksLikeUtr } from '@/lib/utr'
import { claimUtr } from '@/lib/utr-claims'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out' }, { status: 401 })
  const { inr, utr } = await readJson<{ inr?: number; utr?: string }>(req)
  const amount = Number(inr)
  if (!(RECHARGE_OPTIONS_INR as readonly number[]).includes(amount)) return NextResponse.json({ ok: false, code: 'invalid', message: 'Pick an amount.' })
  const check = looksLikeUtr(String(utr ?? ''))
  if (!check.ok) return NextResponse.json({ ok: false, code: 'invalid', message: check.message })

  const claim = await claimUtr(check.utr, session.sub)
  if (!claim.first) {
    console.log('[recharge] reused utr', JSON.stringify({ sub: session.sub, holder: claim.holder }))
    return NextResponse.json({ ok: false, code: 'reused', message: 'This payment reference has already been used. Each payment has its own UTR.' })
  }

  const account = await ensureAccount(session)
  const paise = amount * 100
  const capPaise = AUTO_CREDIT_INR_PER_DAY * 100
  const instant = capPaise > 0 && paise <= capPaise && autoCreditedToday(account) + paise <= capPaise

  if (!instant) {
    const a = await addPending(session.sub, paise, check.utr)
    return NextResponse.json({ ok: true, data: { status: 'pending', balance_paise: a.balancePaise, pending: a.pending.filter((p) => p.status === 'pending').length } })
  }

  const { account: credited, id } = await addApproved(session.sub, paise, check.utr)
  console.log('[recharge] instant credit', JSON.stringify({ sub: session.sub, paise, utr: check.utr }))
  await topUpCustomer(session.sub, paise, id)
  await sendCreditEmail({ to: credited.email, name: credited.name, paise, balancePaise: credited.balancePaise, utr: check.utr })
  return NextResponse.json({ ok: true, data: { status: 'approved', balance_paise: credited.balancePaise, pending: 0 } })
}
