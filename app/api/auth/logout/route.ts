import { NextResponse } from 'next/server'
import { APP_URL } from '@/lib/env'
import { sessionCookie } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST() {
  const res = NextResponse.redirect(`${APP_URL}/`, { status: 303 })
  res.cookies.set(await sessionCookie(null))
  return res
}
