// A review's status, for the page that waits on it.
import { NextResponse } from 'next/server'
import { recoverStale } from '@/lib/review'
import { getReview } from '@/lib/review-store'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out' }, { status: 401 })
  const { id } = await ctx.params
  const found = await getReview(session.sub, id)
  if (!found) return NextResponse.json({ ok: false, code: 'not_found', message: 'That review was not found.' }, { status: 404 })
  const review = await recoverStale(found)
  return NextResponse.json({ ok: true, data: { status: review.status, stage: review.stage ?? null, error: review.error ?? null } })
}
