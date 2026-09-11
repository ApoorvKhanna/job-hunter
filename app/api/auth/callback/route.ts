import { NextResponse } from 'next/server'
import { APP_URL, CLIENT_ID, ISSUER, REDIRECT_URI } from '@/lib/env'
import { PKCE_COOKIE, type Session, sessionCookie, unseal } from '@/lib/session'
import { VaayaClient } from '@/lib/vaaya'

export const dynamic = 'force-dynamic'

function bounce(reason: string) {
  const res = NextResponse.redirect(`${APP_URL}/?error=${encodeURIComponent(reason)}`)
  res.cookies.set({ name: PKCE_COOKIE, value: '', path: '/', maxAge: 0 })
  return res
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const denied = url.searchParams.get('error')
  if (denied) return bounce(denied)
  const cookieHeader = req.headers.get('cookie') ?? ''
  const raw = /(?:^|;\s*)jh_pkce=([^;]+)/.exec(cookieHeader)?.[1]
  const pkce = await unseal<{ verifier: string; state: string }>(raw ? decodeURIComponent(raw) : undefined)
  if (!code || !state || !pkce || pkce.state !== state) return bounce('state_mismatch')

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: pkce.verifier,
  })
  const tokenRes = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  if (!tokenRes.ok) {
    const body = (await tokenRes.json().catch(() => ({}))) as { error?: string }
    return bounce(body.error ?? `token_${tokenRes.status}`)
  }
  const t = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number }
  const session: Session = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + t.expires_in * 1000,
  }
  // One free read to pin the email onto the session for the header.
  const who = await new VaayaClient(session).wallet().catch(() => null)
  if (who?.ok && who.data.email) session.email = who.data.email

  const res = NextResponse.redirect(`${APP_URL}/hunt`)
  res.cookies.set(await sessionCookie(session))
  res.cookies.set({ name: PKCE_COOKIE, value: '', path: '/', maxAge: 0 })
  return res
}
