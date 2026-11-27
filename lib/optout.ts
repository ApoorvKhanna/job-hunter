// "No more email from Job Hunter", for one-off notes like the win-back and as
// a stop for the weekly alerts too. A signed link (HMAC of the sub under
// SESSION_SECRET) so it works without signing in, plus the List-Unsubscribe
// headers Gmail uses for its own one-click unsubscribe: offering that keeps
// people from pressing "report spam", which is what damages a sending domain.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { get, list, put } from '@vercel/blob'
import { APP_URL, SESSION_SECRET } from './env'

const SUB_RE = /^[A-Za-z0-9_-]{1,128}$/
const path = (sub: string) => `optout/${sub}.json`

export function optOutToken(sub: string): string {
  return createHmac('sha256', SESSION_SECRET).update(`mail-optout:${sub}`).digest('hex').slice(0, 32)
}

export function validOptOut(sub: string, token: string | null | undefined): boolean {
  if (!SESSION_SECRET || !token || !SUB_RE.test(sub)) return false
  const want = Buffer.from(optOutToken(sub))
  const got = Buffer.from(token)
  return got.length === want.length && timingSafeEqual(got, want)
}

export const optOutUrl = (sub: string) => `${APP_URL}/api/optout?u=${encodeURIComponent(sub)}&t=${optOutToken(sub)}`

/** Headers that make Gmail and others show their own unsubscribe button; with
 *  the -Post header they POST to the link, which records the opt-out. */
export const optOutHeaders = (sub: string): Record<string, string> => ({
  'List-Unsubscribe': `<${optOutUrl(sub)}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
})

export async function optOut(sub: string): Promise<void> {
  await put(path(sub), JSON.stringify({ at: new Date().toISOString() }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true })
}

export async function isOptedOut(sub: string): Promise<boolean> {
  return !!(await get(path(sub), { access: 'private', useCache: false }).catch(() => null))
}

/** Everyone who opted out, for filtering a whole list at once. */
export async function optedOut(): Promise<Set<string>> {
  const out = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await list({ prefix: 'optout/', cursor, limit: 1000 })
    for (const b of page.blobs) out.add(b.pathname.slice('optout/'.length).replace(/\.json$/, ''))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out
}
