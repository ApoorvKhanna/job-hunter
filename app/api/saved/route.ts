import { NextResponse } from 'next/server'
import { listSaved } from '@/lib/saved'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out' }, { status: 401 })
  return NextResponse.json({ ok: true, data: { items: await listSaved(session.sub) } })
}
