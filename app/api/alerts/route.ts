// Turn the weekly job email on (for this search) or off. Signed-in only.
import { NextResponse } from 'next/server'
import { parseAlertInput, saveAlert, viewOf } from '@/lib/alerts'
import { isBlocked } from '@/lib/blocks'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out', message: 'Please sign in again.' }, { status: 401 })
  if (await isBlocked('sub', session.sub)) return NextResponse.json({ ok: false, code: 'blocked', message: 'This account has been suspended.' }, { status: 403 })
  let body: unknown = {}
  try {
    body = await req.json()
  } catch {}
  const parsed = parseAlertInput(body)
  if (!parsed.ok) return NextResponse.json({ ok: false, code: 'invalid', message: parsed.message }, { status: 400 })
  try {
    const alert = await saveAlert(session, parsed.input)
    return NextResponse.json({ ok: true, data: alert ? viewOf(alert) : null })
  } catch (err) {
    console.error('[alerts] save failed', session.sub, err)
    return NextResponse.json({ ok: false, code: 'failed', message: 'That did not save. Try again.' }, { status: 500 })
  }
}
