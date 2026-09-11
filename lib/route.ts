// Shared handler wrapper for the paid routes: load the session, hand the
// caller a client, re-set the cookie if a refresh rotated the tokens.
import { NextResponse } from 'next/server'
import { readSession, sessionCookie } from './session'
import { type Outcome, VaayaClient } from './vaaya'

export async function withVaaya<T>(
  fn: (v: VaayaClient) => Promise<Outcome<T> | { ok: true; data: T; chargedCents: number; balanceCents: number | null }>,
): Promise<NextResponse> {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out', message: 'Sign in with Vaaya first.' }, { status: 401 })
  const v = new VaayaClient(session)
  let out: Outcome<T>
  try {
    out = (await fn(v)) as Outcome<T>
  } catch (err) {
    out = { ok: false, status: 502, code: 'network_error', message: err instanceof Error ? err.message : String(err) }
  }
  const res = out.ok
    ? NextResponse.json({ ok: true, data: out.data, charged_cents: out.chargedCents, balance_cents: out.balanceCents })
    : NextResponse.json({ ok: false, code: out.code, message: out.message, url: out.url }, { status: out.status === 401 ? 401 : 200 })
  if (v.changed) res.cookies.set(await sessionCookie(v.session))
  return res
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    return {} as T
  }
}

/** Pull a JSON object out of an LLM reply that may be wrapped in prose or fences. */
export function extractJson<T>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
