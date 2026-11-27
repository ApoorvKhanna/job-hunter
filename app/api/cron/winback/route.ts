// The day's win-back batch, every day at 04:30 UTC (10:00 IST), from
// vercel.json: up to DAILY_LIMIT notes, the launch group first, then the
// earlier group, each with its own copy (lib/winback.ts). Vercel sends
// `authorization: Bearer $CRON_SECRET`; without the secret, every request is
// refused. Once everyone has had a note, each run sends nothing.
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { runDaily } from '@/lib/winback'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? ''
  if (!secret) return false
  const got = Buffer.from(req.headers.get('authorization') ?? '')
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, code: 'forbidden' }, { status: 401 })
  const out = await runDaily()
  if (out.error) {
    console.error('[winback] daily run refused', out.error)
    return NextResponse.json({ ok: false, code: out.error }, { status: 503 })
  }
  return NextResponse.json({ ok: true, data: out })
}
