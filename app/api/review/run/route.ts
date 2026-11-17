// Charge for a drafted review and start it. The work runs after the response
// (it takes a minute or two); the page polls GET /api/review/<id>.
import { after, NextResponse } from 'next/server'
import { isBlocked } from '@/lib/blocks'
import { getAccount } from '@/lib/ledger'
import { runReview, startReview } from '@/lib/review'
import { validId } from '@/lib/review-store'
import { readJson } from '@/lib/route'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out', message: 'Please sign in again.' }, { status: 401 })
  if (await isBlocked('sub', session.sub)) return NextResponse.json({ ok: false, code: 'blocked', message: 'This account has been suspended.' }, { status: 403 })
  const { id } = await readJson<{ id?: string }>(req)
  if (!id || !validId(id)) return NextResponse.json({ ok: false, code: 'invalid', message: 'That review was not found.' })
  const out = await startReview(session.sub, id)
  if (!out.ok) return NextResponse.json(out)
  if (out.started) after(() => runReview(session.sub, id))
  const account = await getAccount(session.sub)
  return NextResponse.json({ ok: true, data: { status: out.review.status }, balance: account?.balance ?? 0 })
}
