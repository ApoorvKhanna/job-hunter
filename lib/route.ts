// Shared plumbing for the paid routes: who is calling, can they afford the
// step, run it, debit only on success. Amounts are minor units of the
// account's currency.
import { NextResponse } from 'next/server'
import { type Account, InsufficientBalance, debit, ensureAccount, takeParse } from './ledger'
import { PARSES_PER_DAY, type Step, priceOf } from './prices'
import type { ProviderResult } from './provider'
import { isBlocked } from './blocks'
import { readSession } from './session'

export type ApiOk<T> = { ok: true; data: T; balance: number; charged: number }
export type ApiErr = { ok: false; code: string; message: string; balance?: number; need?: number }

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

function json(body: ApiOk<unknown> | ApiErr, status = 200) {
  return NextResponse.json(body, { status })
}

/** Run one paid step for the signed-in user. A free step (price 0) is
 *  instead capped per day. */
export async function paidStep<T>(
  step: Step,
  fn: (account: Account) => Promise<ProviderResult<T> | { ok: false; code: string; message: string }>,
  /** Runs after a successful charge. Its failure never fails the step. */
  after?: (data: T, sub: string) => Promise<void>,
): Promise<NextResponse> {
  const session = await readSession()
  if (!session) return json({ ok: false, code: 'signed_out', message: 'Please sign in again.' }, 401)
  if (await isBlocked('sub', session.sub)) return json({ ok: false, code: 'blocked', message: 'This account has been suspended.' }, 403)
  const account = await ensureAccount(session)
  const price = priceOf(step, account.currency)
  if (price === 0) {
    if (!(await takeParse(session.sub))) {
      return json({ ok: false, code: 'daily_limit', message: `That is ${PARSES_PER_DAY} free reads today. Try again tomorrow.`, balance: account.balance })
    }
  } else if (account.balance < price) {
    return json({ ok: false, code: 'recharge', message: 'Your balance is too low for this step.', balance: account.balance, need: price })
  }
  let result: ProviderResult<T> | { ok: false; code: string; message: string }
  try {
    result = await fn(account)
  } catch (err) {
    console.error('[step]', step, err)
    return json({ ok: false, code: 'failed', message: 'That step did not go through. Nothing was charged.', balance: account.balance })
  }
  if (!result.ok) return json({ ...result, balance: account.balance })
  if (price === 0) {
    if (after) await after(result.data, session.sub).catch((e) => console.error('[after]', step, e))
    return json({ ok: true, data: result.data, balance: account.balance, charged: 0 })
  }
  try {
    const charged = await debit(session.sub, price, step)
    if (after) await after(result.data, session.sub).catch((e) => console.error('[after]', step, e))
    return json({ ok: true, data: result.data, balance: charged.balance, charged: price })
  } catch (err) {
    if (err instanceof InsufficientBalance) {
      return json({ ok: false, code: 'recharge', message: 'Your balance is too low for this step.', balance: err.balance, need: price })
    }
    // The provider already did the work. Never turn a ledger hiccup into a
    // failed step for the user: hand back the result, skip the charge, log it.
    console.error('[ledger] debit failed after success', step, session.sub, err)
    return json({ ok: true, data: result.data, balance: account.balance, charged: 0 })
  }
}
