// Operator only. GET lists pending UPI recharges; POST approves or rejects one.
import { list } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { ADMIN_TOKEN } from '@/lib/env'
import { topUpCustomer } from '@/lib/customer-flow'
import { getAccount, settlePending } from '@/lib/ledger'
import { readJson } from '@/lib/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: Request): boolean {
  const t = req.headers.get('x-admin-token') ?? new URL(req.url).searchParams.get('token') ?? ''
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const rows: Array<{ sub: string; email: string; name: string; balance_paise: number; wallet: string | null; pending: Array<{ id: string; at: string; paise: number; utr: string }> }> = []
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
      if (pending.length) rows.push({ sub, email: a.email, name: a.name, balance_paise: a.balancePaise, wallet: a.customer?.status === 'ready' ? (a.customer.address ?? a.customer.id) : a.customer?.status ?? null, pending })
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return NextResponse.json({ ok: true, data: { users, rows } })
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { sub, id, status } = await readJson<{ sub?: string; id?: string; status?: 'approved' | 'rejected' }>(req)
  if (!sub || !id || (status !== 'approved' && status !== 'rejected')) return NextResponse.json({ ok: false, code: 'invalid' })
  const a = await settlePending(sub, id, status)
  if (status === 'approved') {
    const paise = a.pending.find((p) => p.id === id)?.paise ?? 0
    if (paise > 0) await topUpCustomer(sub, paise, id)
  }
  return NextResponse.json({ ok: true, data: { balance_paise: a.balancePaise, customer: a.customer ?? null } })
}
