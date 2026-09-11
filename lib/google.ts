// Sign in with Google: plain OAuth 2.0 authorization code, no library.
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from './env'

export function authorizeUrl(state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  u.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'openid email profile')
  u.searchParams.set('state', state)
  u.searchParams.set('prompt', 'select_account')
  return u.toString()
}

export interface GoogleIdentity { sub: string; email: string; name: string; picture?: string }

export async function exchangeCode(code: string): Promise<GoogleIdentity | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) return null
  const t = (await res.json()) as { id_token?: string }
  if (!t.id_token) return null
  // Google validates the signature for us and echoes the claims.
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(t.id_token)}`)
  if (!info.ok) return null
  const c = (await info.json()) as { aud?: string; sub?: string; email?: string; email_verified?: string; name?: string; picture?: string }
  if (c.aud !== GOOGLE_CLIENT_ID || !c.sub || !c.email || c.email_verified !== 'true') return null
  return { sub: c.sub, email: c.email, name: c.name ?? c.email.split('@')[0] ?? '', picture: c.picture }
}
