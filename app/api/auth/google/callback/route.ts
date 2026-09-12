import { NextResponse } from 'next/server'
import { APP_URL } from '@/lib/env'
import { exchangeCode } from '@/lib/google'
import { attachCustomer } from '@/lib/customer-flow'
import { ensureAccount } from '@/lib/ledger'
import { STATE_COOKIE, sessionCookie } from '@/lib/session'

export const dynamic = 'force-dynamic'

function bounce(reason: string) {
  const res = NextResponse.redirect(`${APP_URL}/?error=${encodeURIComponent(reason)}`)
  res.cookies.set({ name: STATE_COOKIE, value: '', path: '/', maxAge: 0 })
  return res
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (url.searchParams.get('error')) return bounce(url.searchParams.get('error') as string)
  const cookieHeader = req.headers.get('cookie') ?? ''
  const expected = /(?:^|;\s*)jh_state=([^;]+)/.exec(cookieHeader)?.[1]
  if (!code || !state || !expected || expected !== state) return bounce('state_mismatch')
  const who = await exchangeCode(code)
  if (!who) return bounce('google_failed')
  await ensureAccount(who)
  // Their own Vaaya wallet, when the feature is on. Best-effort by design.
  await attachCustomer(who.sub)
  const res = NextResponse.redirect(`${APP_URL}/app`)
  res.cookies.set(await sessionCookie({ sub: who.sub, email: who.email, name: who.name, picture: who.picture }))
  res.cookies.set({ name: STATE_COOKIE, value: '', path: '/', maxAge: 0 })
  return res
}
