import { NextResponse } from 'next/server'
import { CLIENT_ID, ISSUER, REDIRECT_URI, SCOPES, assertConfigured } from '@/lib/env'
import { codeChallenge, randomToken } from '@/lib/pkce'
import { PKCE_COOKIE, seal } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const problem = assertConfigured()
  if (problem) return NextResponse.json({ error: 'not_configured', message: problem }, { status: 500 })
  const verifier = randomToken(48)
  const state = randomToken(16)
  const url = new URL(`${ISSUER}/oauth/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', await codeChallenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  const res = NextResponse.redirect(url)
  res.cookies.set({
    name: PKCE_COOKIE,
    value: await seal({ verifier, state }),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  })
  return res
}
