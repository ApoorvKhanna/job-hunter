import { NextResponse } from 'next/server'
import { APP_URL, GOOGLE_CLIENT_ID } from '@/lib/env'
import { authorizeUrl } from '@/lib/google'
import { STATE_COOKIE, randomToken } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!GOOGLE_CLIENT_ID) return NextResponse.redirect(`${APP_URL}/?error=not_configured`)
  const state = randomToken(16)
  const res = NextResponse.redirect(authorizeUrl(state))
  res.cookies.set({ name: STATE_COOKIE, value: state, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 })
  return res
}
