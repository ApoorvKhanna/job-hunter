// The user's Vaaya tokens live in ONE httpOnly cookie, AES-GCM encrypted with
// SESSION_SECRET. No database: the app holds nothing about the user except
// what Vaaya handed it, and a signed-out cookie is gone for good.
import { cookies } from 'next/headers'
import { SESSION_SECRET } from './env'

export interface Session {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
  email?: string
}

export const SESSION_COOKIE = 'jh_session'
export const PKCE_COOKIE = 'jh_pkce'
const SESSION_MAX_AGE = 60 * 24 * 60 * 60 // 60 days = Vaaya refresh-token life

async function key(): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SESSION_SECRET))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function seal(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(value))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), data))
  return `${toB64(iv)}.${toB64(ct)}`
}

export async function unseal<T>(sealed: string | undefined): Promise<T | null> {
  if (!sealed) return null
  const [ivB64, ctB64] = sealed.split('.')
  if (!ivB64 || !ctB64) return null
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64) },
      await key(),
      fromB64(ctB64),
    )
    return JSON.parse(new TextDecoder().decode(pt)) as T
  } catch {
    return null
  }
}

export async function readSession(): Promise<Session | null> {
  const jar = await cookies()
  return unseal<Session>(jar.get(SESSION_COOKIE)?.value)
}

export async function sessionCookie(session: Session | null) {
  return {
    name: SESSION_COOKIE,
    value: session ? await seal(session) : '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: session ? SESSION_MAX_AGE : 0,
  }
}
