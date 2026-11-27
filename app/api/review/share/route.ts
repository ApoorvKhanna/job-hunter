// Share the 6-second scan score: a public card at /s/<token> showing the
// score and the target roles, nothing else. The owner only, one card per
// review; asking again returns the same link.
import { NextResponse } from 'next/server'
import { isBlocked } from '@/lib/blocks'
import { validId } from '@/lib/review-store'
import { readJson } from '@/lib/route'
import { readSession } from '@/lib/session'
import { shareReview, shareUrl } from '@/lib/share-store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out', message: 'Please sign in again.' }, { status: 401 })
  if (await isBlocked('sub', session.sub)) return NextResponse.json({ ok: false, code: 'blocked', message: 'This account has been suspended.' }, { status: 403 })
  const { id } = await readJson<{ id?: unknown }>(req)
  if (typeof id !== 'string' || !validId(id)) return NextResponse.json({ ok: false, code: 'not_found', message: 'That review was not found.' }, { status: 404 })
  try {
    const out = await shareReview(session.sub, id)
    if (!out.ok) return NextResponse.json(out, { status: out.code === 'not_found' ? 404 : 409 })
    return NextResponse.json({ ok: true, data: { url: shareUrl(out.share.token) } })
  } catch (err) {
    console.error('[share] failed', id, err)
    return NextResponse.json({ ok: false, code: 'failed', message: 'Could not make a link. Try again.' }, { status: 500 })
  }
}
