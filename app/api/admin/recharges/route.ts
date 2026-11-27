// Operator only. GET lists pending UPI recharges, the last week's instant
// credits for review, and every account's money in its own currency. POST
// approves or rejects a pending recharge, or reverses an approved one.
import { list } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { ADMIN_TOKEN } from '@/lib/env'
import { getAccount, reverseApproved, settlePending } from '@/lib/ledger'
import { sendCreditEmail } from '@/lib/notify'
import type { Currency } from '@/lib/prices'
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
  type Row = { sub: string; email: string; name: string; currency: Currency; balance: number; wallet: string | null; pending: Item[]; recent: Item[] }
  type Person = { sub: string; email: string; name: string; currency: Currency; created_at: string; balance: number; paid: number; payments: number; spent: number; steps: number; reviews: number; last_at: string | null }
  type Totals = { accounts: number; payments: number; paid: number; balance: number; spent: number; welcome: number; paying_users: number; reviews: number }
  const rows: Row[] = []
  const people: Person[] = []
  const zero = (): Totals => ({ accounts: 0, payments: 0, paid: 0, balance: 0, spent: 0, welcome: 0, paying_users: 0, reviews: 0 })
  const totals: Record<Currency, Totals> = { inr: zero(), usd: zero() }
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
        rows.push({ sub, email: a.email, name: a.name, currency: a.currency, balance: a.balance, wallet: a.customer?.status === 'ready' ? (a.customer.address ?? a.customer.id) : a.customer?.status ?? null, pending, recent })
      // Money view: what came in (manual UPI + Stripe), what was granted,
      // what was spent net of refunds.
      const upi = a.pending.filter((p) => p.status === 'approved')
      const stripe = a.entries.filter((e) => e.kind === 'credit' && /^Top-up/.test(e.note))
      const paid = upi.reduce((n, p) => n + p.paise, 0) + stripe.reduce((n, e) => n + e.amount, 0)
      const refunds = a.entries.filter((e) => e.kind === 'credit' && /refunded|returned/.test(e.note)).reduce((n, e) => n + e.amount, 0)
      const debits = a.entries.filter((e) => e.kind === 'debit' && !/^Recharge reversed/.test(e.note))
      const spent = debits.reduce((n, e) => n + e.amount, 0) - refunds
      const welcome = a.entries.filter((e) => e.kind === 'credit' && /welcome/i.test(e.note)).reduce((n, e) => n + e.amount, 0)
      const reviews = debits.filter((e) => /^review /.test(e.note)).length - a.entries.filter((e) => e.kind === 'credit' && /^review .*(refunded|returned)/.test(e.note)).length
      // Most steps are free now and leave no entry: count them from the
      // account's lifetime counters, and take the latest use as activity.
      const counts = a.counts ?? {}
      const freeSteps = (['parse', 'jobs', 'contact', 'draft', 'preview'] as const).reduce((n, k) => n + (counts[k] ?? 0), 0)
      const uses = Object.values(a.uses ?? {}).flat()
      const lastAt = [a.entries[0]?.at, ...uses].filter((x): x is string => !!x).sort().at(-1) ?? null
      people.push({ sub, email: a.email, name: a.name, currency: a.currency, created_at: a.createdAt, balance: a.balance, paid, payments: upi.length + stripe.length, spent, steps: debits.length + freeSteps, reviews, last_at: lastAt })
      const t = totals[a.currency]
      t.accounts++
      t.payments += upi.length + stripe.length
      t.paid += paid
      t.balance += a.balance
      t.spent += spent
      t.welcome += welcome
      t.reviews += reviews
      if (paid > 0) t.paying_users++
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  people.sort((x, y) => (y.paid - x.paid) || (y.balance - x.balance) || (y.last_at ?? '').localeCompare(x.last_at ?? ''))
  return NextResponse.json({ ok: true, data: { users, rows, totals, people } })
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { sub, id, status } = await readJson<{ sub?: string; id?: string; status?: 'approved' | 'rejected' | 'reversed' }>(req)
  if (!sub || !id || (status !== 'approved' && status !== 'rejected' && status !== 'reversed')) return NextResponse.json({ ok: false, code: 'invalid' })
  if (status === 'reversed') {
    const a = await reverseApproved(sub, id)
    return NextResponse.json({ ok: true, data: { balance: a.balance, customer: a.customer ?? null } })
  }
  const a = await settlePending(sub, id, status)
  if (status === 'approved') {
    const p = a.pending.find((x) => x.id === id)
    if (p && p.paise > 0) {
      await sendCreditEmail({ to: a.email, name: a.name, paise: p.paise, balancePaise: a.balance, utr: p.utr })
    }
  }
  return NextResponse.json({ ok: true, data: { balance: a.balance, customer: a.customer ?? null } })
}
