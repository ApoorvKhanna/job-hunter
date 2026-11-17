// One public address. In production, the old *.vercel.app addresses and www
// send pages to APP_URL's host. API routes are left alone, so a sign-in or a
// payment that started on an old address can still finish there.
import { NextResponse, type NextRequest } from 'next/server'

export function middleware(req: NextRequest) {
  if (process.env.VERCEL_ENV !== 'production' || !process.env.APP_URL) return NextResponse.next()
  let canonical: string
  try {
    canonical = new URL(process.env.APP_URL).host
  } catch {
    return NextResponse.next()
  }
  const host = req.headers.get('host') ?? ''
  if (!host || host === canonical) return NextResponse.next()
  if (!host.endsWith('.vercel.app') && host !== `www.${canonical}`) return NextResponse.next()
  return NextResponse.redirect(new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, `https://${canonical}`), 308)
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico|.*\\.(?:jpg|jpeg|png|svg|ico|webp|pdf)$).*)'],
}
