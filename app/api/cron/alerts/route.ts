// The weekly job email, Mondays 03:30 UTC (09:00 IST), from vercel.json.
// Vercel sends `authorization: Bearer $CRON_SECRET`; without the secret set,
// every request is refused.
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { runAlerts } from '@/lib/alerts'

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
  if (!process.env.CRON_SECRET) console.error('[alerts] CRON_SECRET is not set; refusing the run')
  if (!authorized(req)) return NextResponse.json({ ok: false, code: 'forbidden' }, { status: 401 })
  const out = await runAlerts()
  if ('error' in out) {
    console.error('[alerts] run refused', out.error)
    return NextResponse.json({ ok: false, code: out.error }, { status: 503 })
  }
  return NextResponse.json({ ok: true, data: out })
}
