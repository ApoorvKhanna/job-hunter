// Shared plumbing for the paid routes: who is calling, can they afford the
// step, run it, debit only on success.
import { NextResponse } from 'next/server'
import { type Account, InsufficientBalance, debit, ensureAccount } from './ledger'
import { PRICE_PAISE, type Step } from './prices'
import type { ProviderResult } from './provider'
import { isBlocked } from './blocks'
import { readSession } from './session'

export type ApiOk<T> = { ok: true; data: T; balance_paise: number; charged_paise: number }
export type ApiErr = { ok: false; code: string; message: string; balance_paise?: number; need_paise?: number }

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

/** Run one paid step for the signed-in user. */
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
  const price = PRICE_PAISE[step]
  if (account.balancePaise < price) {
    return json({ ok: false, code: 'recharge', message: 'Your balance is too low for this step.', balance_paise: account.balancePaise, need_paise: price })
  }
  let result: ProviderResult<T> | { ok: false; code: string; message: string }
  try {
    result = await fn(account)
  } catch (err) {
    console.error('[step]', step, err)
    return json({ ok: false, code: 'failed', message: 'That step did not go through. Nothing was charged.', balance_paise: account.balancePaise })
  }
  if (!result.ok) return json({ ...result, balance_paise: account.balancePaise })
  try {
    const charged = await debit(session.sub, price, step)
    if (after) await after(result.data, session.sub).catch((e) => console.error('[after]', step, e))
    return json({ ok: true, data: result.data, balance_paise: charged.balancePaise, charged_paise: price })
  } catch (err) {
    if (err instanceof InsufficientBalance) {
      return json({ ok: false, code: 'recharge', message: 'Your balance is too low for this step.', balance_paise: err.balancePaise, need_paise: price })
    }
    // The provider already did the work. Never turn a ledger hiccup into a
    // failed step for the user: hand back the result, skip the charge, log it.
    console.error('[ledger] debit failed after success', step, session.sub, err)
    return json({ ok: true, data: result.data, balance_paise: account.balancePaise, charged_paise: 0 })
  }
}
