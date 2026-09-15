// Operator only. POST { email | sub, network?: boolean, reason? } blocks the
// account and, when asked, the network it signed up from. Existing sessions
// lose every paid step at once; the next sign-in bounces.
import { list } from '@vercel/blob'
import { NextResponse } from 'next/server'
import { block } from '@/lib/blocks'
import { ADMIN_TOKEN } from '@/lib/env'
import { getAccount } from '@/lib/ledger'
import { readJson } from '@/lib/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function authorized(req: Request): boolean {
  const t = req.headers.get('x-admin-token') ?? new URL(req.url).searchParams.get('token') ?? ''
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })
  const { email, sub, network, reason } = await readJson<{ email?: string; sub?: string; network?: boolean; reason?: string }>(req)
  let target = sub ? await getAccount(String(sub)) : null
  if (!target && email) {
    const want = String(email).trim().toLowerCase()
    let cursor: string | undefined
    do {
      const page = await list({ prefix: 'users/', cursor, limit: 1000 })
      for (const b of page.blobs) {
        const a = await getAccount(b.pathname.slice('users/'.length).replace(/\.json$/, ''))
        if (a?.email.toLowerCase() === want) {
          target = a
          break
        }
      }
      cursor = target || !page.hasMore ? undefined : page.cursor
    } while (cursor)
  }
  if (!target) return NextResponse.json({ ok: false, code: 'not_found' })
  const why = String(reason ?? 'operator block').slice(0, 120)
  await block('sub', target.sub, why)
  let networkBlocked: string | null = null
  if (network && target.network) {
    await block('network', target.network, `${why} (via ${target.email})`)
    networkBlocked = target.network
  }
  return NextResponse.json({ ok: true, data: { sub: target.sub, email: target.email, network_blocked: networkBlocked, network_known: !!target.network } })
}
