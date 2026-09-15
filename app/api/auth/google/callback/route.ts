import { NextResponse } from 'next/server'
import { APP_URL, START_CREDIT_PAISE } from '@/lib/env'
import { exchangeCode } from '@/lib/google'
import { attachCustomer } from '@/lib/customer-flow'
import { isBlocked } from '@/lib/blocks'
import { IP_GATE, claimNetwork, clientIp, networkKey } from '@/lib/ipgate'
import { ensureAccount, getAccount } from '@/lib/ledger'
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
  const ipNow = clientIp(req)
  if ((await isBlocked('sub', who.sub)) || (await isBlocked('network', ipNow ? networkKey(ipNow) : null))) {
    console.log('[block] sign-in refused', JSON.stringify({ sub: who.sub }))
    return bounce('blocked')
  }
  // One welcome credit per network. Only a brand-new account is judged; an
  // existing account signs in from anywhere.
  let welcomePaise = START_CREDIT_PAISE
  let network: string | undefined
  const ip = clientIp(req)
  if (IP_GATE !== 'off' && ip && !(await getAccount(who.sub))) {
    const claim = await claimNetwork(ip, who.sub)
    network = networkKey(ip)
    if (!claim.first) {
      console.log('[gate] repeat network', JSON.stringify({ sub: who.sub, holder: claim.holder, mode: IP_GATE }))
      if (IP_GATE === 'block') return bounce('one_per_network')
      welcomePaise = 0
    }
  }
  await ensureAccount(who, { welcomePaise, network })
  // Their own Vaaya wallet, when the feature is on. Best-effort by design.
  await attachCustomer(who.sub, who.email)
  const res = NextResponse.redirect(`${APP_URL}/app`)
  res.cookies.set(await sessionCookie({ sub: who.sub, email: who.email, name: who.name, picture: who.picture }))
  res.cookies.set({ name: STATE_COOKIE, value: '', path: '/', maxAge: 0 })
  return res
}
