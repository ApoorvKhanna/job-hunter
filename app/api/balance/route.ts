import { NextResponse } from 'next/server'
import { UPI_ID, UPI_NAME } from '@/lib/env'
import { ensureAccount } from '@/lib/ledger'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out' }, { status: 401 })
  const a = await ensureAccount(session)
  return NextResponse.json({
    ok: true,
    data: {
      balance_paise: a.balancePaise,
      pending: a.pending.filter((p) => p.status === 'pending').map((p) => ({ paise: p.paise, at: p.at })),
      entries: a.entries.slice(0, 20),
      upi: { id: UPI_ID, name: UPI_NAME },
    },
  })
}
