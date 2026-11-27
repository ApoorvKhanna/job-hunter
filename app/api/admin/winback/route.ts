// Operator only. GET previews the launch-day win-back note: who gets it and
// the exact text. POST { send: true } sends it, once per person.
import { NextResponse } from 'next/server'
import { ADMIN_TOKEN } from '@/lib/env'
import { readJson } from '@/lib/route'
import { WINDOW, candidates, sendAll } from '@/lib/winback'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: Request): boolean {
  const t = req.headers.get('x-admin-token') ?? new URL(req.url).searchParams.get('token') ?? ''
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { recipients, sample } = await candidates()
  return NextResponse.json({ ok: true, data: { window: WINDOW, count: recipients.length, sample, recipients: recipients.map((r) => ({ email: r.email, name: r.name, createdAt: r.createdAt, line: r.line })) } })
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { send } = await readJson<{ send?: boolean }>(req)
  if (send !== true) return NextResponse.json({ ok: false, message: 'Pass { "send": true } to send.' }, { status: 400 })
  return NextResponse.json({ ok: true, data: await sendAll() })
}
