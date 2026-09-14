// Operator only. POST labels every existing customer wallet on the provider
// with the user's sign-in email, for accounts created before labels existed.
// Idempotent; safe to run again.
import { list } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { attachCustomer } from '@/lib/customer-flow'
import { ADMIN_TOKEN } from '@/lib/env'
import { getAccount } from '@/lib/ledger'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: Request): boolean {
  const t = req.headers.get('x-admin-token') ?? new URL(req.url).searchParams.get('token') ?? ''
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, code: 'forbidden' }, { status: 403 })
  let cursor: string | undefined
  const subs: string[] = []
  do {
    const page = await list({ prefix: 'users/', cursor, limit: 1000 })
    for (const b of page.blobs) {
      const m = /^users\/(\d+)\.json$/.exec(b.pathname)
      if (m) subs.push(m[1])
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  let labelled = 0
  let skipped = 0
  for (const sub of subs) {
    const account = await getAccount(sub)
    if (!account?.email) {
      skipped++
      continue
    }
    // Always re-send: the provider may have been told before it kept labels.
    const c = await attachCustomer(sub, account.email, true)
    if (c?.label === account.email) labelled++
    else skipped++
  }
  return NextResponse.json({ ok: true, data: { users: subs.length, labelled, skipped } })
}
