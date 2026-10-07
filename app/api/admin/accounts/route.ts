// Operator only. GET walks every account and returns money totals plus one
// row per person: balance, card top-ups, what they spent on runs.
import { list } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { ADMIN_TOKEN } from '@/lib/env'
import { getAccount } from '@/lib/ledger'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function authorized(req: Request): boolean {
  const t = req.headers.get('x-admin-token') ?? new URL(req.url).searchParams.get('token') ?? ''
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  type Person = { sub: string; email: string; name: string; created_at: string; balance_cents: number; topped_up_cents: number; top_ups: number; spent_cents: number; runs: number; last_at: string | null }
  const people: Person[] = []
  const totals = { accounts: 0, top_ups: 0, topped_up_cents: 0, balance_cents: 0, spent_cents: 0, welcome_cents: 0, paying_users: 0 }
  let cursor: string | undefined
  do {
    const page = await list({ prefix: 'users/', cursor, limit: 1000 })
    for (const b of page.blobs) {
      const sub = b.pathname.slice('users/'.length).replace(/\.json$/, '')
      const a = await getAccount(sub)
      if (!a) continue
      const sum = (kind: 'credit' | 'debit', note: RegExp) => a.entries.filter((e) => e.kind === kind && note.test(e.note)).reduce((n, e) => n + e.cents, 0)
      const toppedUp = sum('credit', /^Card top-up/)
      const spent = sum('debit', /^Search/)
      people.push({
        sub,
        email: a.email,
        name: a.name,
        created_at: a.createdAt,
        balance_cents: a.balanceCents,
        topped_up_cents: toppedUp,
        top_ups: a.entries.filter((e) => e.kind === 'credit' && /^Card top-up/.test(e.note)).length,
        spent_cents: spent,
        runs: a.entries.filter((e) => e.kind === 'debit' && /^Search/.test(e.note)).length,
        last_at: a.entries[0]?.at ?? null,
      })
      totals.accounts++
      totals.top_ups += people[people.length - 1].top_ups
      totals.topped_up_cents += toppedUp
      totals.balance_cents += a.balanceCents
      totals.spent_cents += spent
      totals.welcome_cents += sum('credit', /^Welcome/)
      if (toppedUp > 0) totals.paying_users++
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  people.sort((x, y) => y.topped_up_cents - x.topped_up_cents || y.runs - x.runs || (y.last_at ?? '').localeCompare(x.last_at ?? ''))
  return NextResponse.json({ ok: true, data: { totals, people } })
}
