// Shared plumbing for the job-hunt steps: who is calling, may they run the
// step, run it, then count or charge it only on success. Reading a resume,
// searching, finding people and drafting are free within a daily allowance;
// finding an email spends an email credit (or, for older accounts, the legacy
// price from their money balance). See lib/prices.ts.
import { NextResponse } from 'next/server'
import { type Account, InsufficientBalance, type Take, canPayEmail, ensureAccount, getAccount, releaseFree, spendEmail, takeFree, walletOf } from './ledger'
import { type Allowance, LEGACY_EMAIL_PRICE, type Step, type Wallet } from './prices'
import type { ProviderResult } from './provider'
import { isBlocked } from './blocks'
import { readSession } from './session'

export type ApiOk<T> = { ok: true; data: T; wallet: Wallet; balance: number; left?: number }
/** `code: 'recharge'` opens the packs sheet, with `reason` saying why. */
export type ApiErr = { ok: false; code: string; message: string; wallet?: Wallet; balance?: number; reason?: 'email' | 'deep' | 'limit' }

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

const NOUN: Record<Allowance, string> = { parse: 'resume reads', jobs: 'searches', contact: 'company lookups', draft: 'drafts', preview: 'scans' }

/** The line shown when a daily allowance is used up. */
export function limitMessage(kind: Allowance, take: Take): string {
  const what = `${take.limit} free ${NOUN[kind]}`
  return take.tier === 'free'
    ? `That is your ${what} for today. They come back tomorrow, or any email pack raises the daily limit.`
    : `That is your ${what} for today. They come back tomorrow.`
}

type StepResult<T> = ProviderResult<T> | { ok: false; code: string; message: string; reason?: ApiErr['reason'] }

/** Run one job-hunt step for the signed-in user. A free step takes one use
 *  of today's allowance up front (so parallel clicks cannot overrun it) and
 *  gives it back if the step fails. The email step needs an email credit (or
 *  the legacy price in money) and is charged only when an address comes back. */
export async function paidStep<T>(
  step: Step,
  fn: (account: Account) => Promise<StepResult<T>>,
  /** Runs after success. Its failure never fails the step. */
  after?: (data: T, sub: string) => Promise<void>,
): Promise<NextResponse> {
  const session = await readSession()
  if (!session) return json({ ok: false, code: 'signed_out', message: 'Please sign in again.' }, 401)
  if (await isBlocked('sub', session.sub)) return json({ ok: false, code: 'blocked', message: 'This account has been suspended.' }, 403)
  const sub = session.sub
  const account = await ensureAccount(session)
  const legacy = LEGACY_EMAIL_PRICE[account.currency]
  const kind: Allowance | null = step === 'email' ? null : step
  let take: Take | null = null
  if (kind === null) {
    if (!canPayEmail(account, legacy)) {
      return json({ ok: false, code: 'recharge', reason: 'email', message: 'You are out of emails. Pick a pack to keep going.', wallet: walletOf(account), balance: account.balance })
    }
  } else {
    try {
      take = await takeFree(sub, kind)
    } catch (err) {
      // Many clicks at once can outlast the write retries. Nothing ran.
      console.error('[allowance] take failed', step, sub, err)
      return json({ ok: false, code: 'failed', message: 'Too many at once. Try again in a moment.', wallet: walletOf(account), balance: account.balance })
    }
    if (!take.ok) {
      return json({ ok: false, code: 'daily_limit', reason: take.tier === 'free' ? 'limit' : undefined, message: limitMessage(kind, take), wallet: walletOf(account), balance: account.balance })
    }
  }
  const giveBack = async () => {
    if (kind && take) await releaseFree(sub, kind, take.token).catch((e) => console.error('[allowance] release failed', step, sub, e))
  }

  let result: StepResult<T>
  try {
    result = await fn(account)
  } catch (err) {
    console.error('[step]', step, err)
    await giveBack()
    return json({ ok: false, code: 'failed', message: 'That step did not go through. Nothing was used. Try again.', wallet: walletOf(account), balance: account.balance })
  }
  if (!result.ok) {
    await giveBack()
    return json({ ...result, wallet: walletOf(account), balance: account.balance })
  }

  let latest: Account = account
  if (kind === null) {
    try {
      latest = (await spendEmail(sub, legacy)).account
    } catch (err) {
      if (err instanceof InsufficientBalance) {
        // The last credit went to a parallel request: send what is left now.
        const now = (await getAccount(sub).catch(() => null)) ?? account
        return json({ ok: false, code: 'recharge', reason: 'email', message: 'You are out of emails. Pick a pack to keep going.', wallet: walletOf(now), balance: now.balance })
      }
      // The provider already did the work. Never turn a ledger hiccup into a
      // failed step for the user: hand back the result uncharged, log it.
      console.error('[ledger] email charge failed after success', sub, err)
    }
  } else {
    // Picks up anything the step itself spent (a deep search).
    latest = (await getAccount(sub)) ?? account
  }
  if (after) await after(result.data, sub).catch((e) => console.error('[after]', step, e))
  return json({ ok: true, data: result.data, wallet: walletOf(latest), balance: latest.balance, ...(take ? { left: take.left } : {}) })
}
