// The free 6-second scan for a drafted review: the heatmap and the score,
// before paying. One model call, within a daily allowance.
import { NextResponse } from 'next/server'
import { isBlocked } from '@/lib/blocks'
import { previewReview } from '@/lib/review'
import { validId } from '@/lib/review-store'
import { readJson } from '@/lib/route'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out', message: 'Please sign in again.' }, { status: 401 })
  if (await isBlocked('sub', session.sub)) return NextResponse.json({ ok: false, code: 'blocked', message: 'This account has been suspended.' }, { status: 403 })
  const { id } = await readJson<{ id?: string }>(req)
  if (!id || !validId(id)) return NextResponse.json({ ok: false, code: 'invalid', message: 'That review was not found.' })
  const out = await previewReview(session.sub, id)
  if (!out.ok) return NextResponse.json(out)
  return NextResponse.json({ ok: true, data: { id, score: out.review.preview?.scan.score ?? null } })
}
