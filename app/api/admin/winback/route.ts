// Operator only. GET ?cohort=launch|earlier previews that group's one-time
// note: who gets it and the exact text. POST { test: true, cohort } mails one
// copy to the reply-to inbox; POST { send: true, cohort } sends it to the next
// batch, once per person.
import { NextResponse } from 'next/server'
import { ADMIN_TOKEN } from '@/lib/env'
import { readJson } from '@/lib/route'
import { COHORTS, candidates, isCohort, sendAll, sendTest } from '@/lib/winback'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: Request): boolean {
  const t = req.headers.get('x-admin-token') ?? new URL(req.url).searchParams.get('token') ?? ''
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const cohort = new URL(req.url).searchParams.get('cohort') ?? 'launch'
  if (!isCohort(cohort)) return NextResponse.json({ ok: false, message: 'Unknown group.' }, { status: 400 })
  const { recipients, sample } = await candidates(cohort)
  return NextResponse.json({ ok: true, data: { cohort, label: COHORTS[cohort].label, count: recipients.length, sample, recipients: recipients.map((r) => ({ email: r.email, name: r.name, createdAt: r.createdAt, line: r.line })) } })
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { send, test, cohort } = await readJson<{ send?: boolean; test?: boolean; cohort?: string }>(req)
  if (test === true && isCohort(cohort)) return NextResponse.json({ ok: true, data: await sendTest(cohort) })
  if (send !== true || !isCohort(cohort)) return NextResponse.json({ ok: false, message: 'Pass { "send": true, "cohort": "launch" | "earlier" }.' }, { status: 400 })
  return NextResponse.json({ ok: true, data: await sendAll(cohort) })
}
