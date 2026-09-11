// The user paid by UPI and typed the UTR. Record it as pending; an operator
// approves it on /admin and the credit lands.
import { NextResponse } from 'next/server'
import { addPending } from '@/lib/ledger'
import { RECHARGE_OPTIONS_INR } from '@/lib/prices'
import { readJson } from '@/lib/route'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out' }, { status: 401 })
  const { inr, utr } = await readJson<{ inr?: number; utr?: string }>(req)
  const amount = Number(inr)
  if (!(RECHARGE_OPTIONS_INR as readonly number[]).includes(amount)) return NextResponse.json({ ok: false, code: 'invalid', message: 'Pick an amount.' })
  const ref = String(utr ?? '').trim()
  if (!/^[A-Za-z0-9-]{8,30}$/.test(ref)) return NextResponse.json({ ok: false, code: 'invalid', message: 'Enter the 12-digit UTR / transaction ID from your UPI app.' })
  const a = await addPending(session.sub, amount * 100, ref)
  return NextResponse.json({ ok: true, data: { pending: a.pending.filter((p) => p.status === 'pending').length } })
}
