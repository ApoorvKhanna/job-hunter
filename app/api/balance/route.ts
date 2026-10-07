import { NextResponse } from 'next/server'
import { caller } from '@/lib/route'

export const dynamic = 'force-dynamic'

export async function GET() {
  const who = await caller()
  if ('response' in who) return who.response
  const a = who.account
  return NextResponse.json({ ok: true, data: { balance_cents: a.balanceCents, entries: a.entries.slice(0, 20) } })
}
