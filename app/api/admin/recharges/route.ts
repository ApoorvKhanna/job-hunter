// Operator only. GET lists pending UPI recharges plus the last week's instant
// credits for review; POST approves or rejects a pending one, or reverses an
// approved one.
import { list } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { ADMIN_TOKEN } from '@/lib/env'
import { getAccount, reverseApproved, settlePending } from '@/lib/ledger'
import { sendCreditEmail } from '@/lib/notify'
import { readJson } from '@/lib/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: Request): boolean {
  const t = req.headers.get('x-admin-token') ?? new URL(req.url).searchParams.get('token') ?? ''
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  type Item = { id: string; at: string; paise: number; utr: string; status: string; auto?: boolean; settledAt?: string }
  type Row = { sub: string; email: string; name: string; balance_paise: number; wallet: string | null; pending: Item[]; recent: Item[] }
  type Person = { sub: string; email: string; name: string; created_at: string; balance_paise: number; recharged_paise: number; recharges: number; spent_paise: number; steps: number; last_at: string | null }
  const rows: Row[] = []
  const people: Person[] = []
  const totals = { accounts: 0, recharges: 0, recharged_paise: 0, balance_paise: 0, spent_paise: 0, welcome_paise: 0, paying_users: 0 }
  const weekAgo = Date.now() - 7 * 86400000
  let cursor: string | undefined
  let users = 0
  do {
    const page = await list({ prefix: 'users/', cursor, limit: 1000 })
    for (const b of page.blobs) {
      users++
      const sub = b.pathname.slice('users/'.length).replace(/\.json$/, '')
      const a = await getAccount(sub)
      if (!a) continue
      const pending = a.pending.filter((p) => p.status === 'pending')
      const recent = a.pending.filter((p) => p.auto && p.status === 'approved' && Date.parse(p.at) > weekAgo)
      if (pending.length || recent.length)
        rows.push({ sub, email: a.email, name: a.name, balance_paise: a.balancePaise, wallet: a.customer?.status === 'ready' ? (a.customer.address ?? a.customer.id) : a.customer?.status ?? null, pending, recent })
      // Money view: what came in by UPI, what was granted, what was spent.
      const approved = a.pending.filter((p) => p.status === 'approved')
      const recharged = approved.reduce((n, p) => n + p.paise, 0)
      const spent = a.entries.filter((e) => e.kind === 'debit').reduce((n, e) => n + e.paise, 0)
      const welcome = a.entries.filter((e) => e.kind === 'credit' && /welcome/i.test(e.note)).reduce((n, e) => n + e.paise, 0)
      const steps = a.entries.filter((e) => e.kind === 'debit').length
      const lastAt = a.entries[0]?.at ?? null
      people.push({ sub, email: a.email, name: a.name, created_at: a.createdAt, balance_paise: a.balancePaise, recharged_paise: recharged, recharges: approved.length, spent_paise: spent, steps, last_at: lastAt })
      totals.accounts++
      totals.recharges += approved.length
      totals.recharged_paise += recharged
      totals.balance_paise += a.balancePaise
      totals.spent_paise += spent
      totals.welcome_paise += welcome
      if (recharged > 0) totals.paying_users++
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  people.sort((x, y) => (y.recharged_paise - x.recharged_paise) || (y.balance_paise - x.balance_paise) || (y.last_at ?? '').localeCompare(x.last_at ?? ''))
  return NextResponse.json({ ok: true, data: { users, rows, totals, people } })
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { sub, id, status } = await readJson<{ sub?: string; id?: string; status?: 'approved' | 'rejected' | 'reversed' }>(req)
  if (!sub || !id || (status !== 'approved' && status !== 'rejected' && status !== 'reversed')) return NextResponse.json({ ok: false, code: 'invalid' })
  if (status === 'reversed') {
    const a = await reverseApproved(sub, id)
    return NextResponse.json({ ok: true, data: { balance_paise: a.balancePaise, customer: a.customer ?? null } })
  }
  const a = await settlePending(sub, id, status)
  if (status === 'approved') {
    const p = a.pending.find((x) => x.id === id)
    if (p && p.paise > 0) {
      await sendCreditEmail({ to: a.email, name: a.name, paise: p.paise, balancePaise: a.balancePaise, utr: p.utr })
    }
  }
  return NextResponse.json({ ok: true, data: { balance_paise: a.balancePaise, customer: a.customer ?? null } })
}
