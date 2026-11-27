import { NextResponse } from 'next/server'
import { ensureAccount, walletOf } from '@/lib/ledger'
import { readSession } from '@/lib/session'
import { payConfig } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out' }, { status: 401 })
  const a = await ensureAccount(session)
  return NextResponse.json({
    ok: true,
    data: {
      currency: a.currency,
      balance: a.balance,
      wallet: walletOf(a),
      pending: a.pending.filter((p) => p.status === 'pending').map((p) => ({ paise: p.paise, at: p.at })),
      entries: a.entries.slice(0, 20),
      pay: payConfig(),
    },
  })
}
