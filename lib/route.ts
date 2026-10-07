// Shared plumbing for the API routes: who is calling, and how a step inside
// a run answers.
import { NextResponse } from 'next/server'
import { isBlocked } from './blocks'
import { type Account, ensureAccount } from './ledger'
import { type StepOutcome, runStep } from './runs'
import { type Session, readSession } from './session'

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    return {} as T
  }
}

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

/** The signed-in, unblocked caller and their account, or the response to send instead. */
export async function caller(): Promise<{ session: Session; account: Account } | { response: NextResponse }> {
  const session = await readSession()
  if (!session) return { response: NextResponse.json({ ok: false, code: 'signed_out', message: 'Please sign in again' }, { status: 401 }) }
  if (await isBlocked('sub', session.sub)) {
    return { response: NextResponse.json({ ok: false, code: 'blocked', message: 'This account has been suspended' }, { status: 403 }) }
  }
  return { session, account: await ensureAccount(session) }
}

/** Run one lookup inside the caller's run and answer with what is left. */
export async function runStepResponse<T>(
  args: Omit<Parameters<typeof runStep<T>>[0], 'sub'>,
  /** Runs after a hit. Its failure never fails the step. */
  after?: (data: T, sub: string) => Promise<void>,
): Promise<NextResponse> {
  const who = await caller()
  if ('response' in who) return who.response
  let out: StepOutcome<T>
  try {
    out = await runStep<T>({ ...args, sub: who.session.sub })
  } catch (err) {
    console.error('[step]', args.kind, err)
    return NextResponse.json({ ok: false, code: 'failed', message: 'That step did not go through. Try again' })
  }
  if (out.ok && after) await after(out.data, who.session.sub).catch((e) => console.error('[after]', args.kind, e))
  return NextResponse.json(out)
}
