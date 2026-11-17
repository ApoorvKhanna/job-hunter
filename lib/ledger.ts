// Per-user money, one private JSON blob per user. Writes are optimistic:
// read with the ETag, write with ifMatch, retry on a precondition failure.
// Amounts are integer minor units of the account's currency (paise for INR,
// cents for USD). Nothing here ever goes negative.
import { BlobPreconditionFailedError, get, put } from '@vercel/blob'
import { headers } from 'next/headers'
import { DEFAULT_CURRENCY } from './env'
import { type Currency, PARSES_PER_DAY, WELCOME, currencyForCountry } from './prices'

export interface Entry { at: string; kind: 'credit' | 'debit'; amount: number; note: string }
/** A manual UPI recharge (QR + UTR). Always rupees. */
export interface Pending {
  id: string
  at: string
  paise: number
  utr: string
  status: 'pending' | 'approved' | 'rejected' | 'reversed'
  /** Credited the moment the reference was entered (under the daily cap). */
  auto?: boolean
  /** When it was approved / rejected / reversed. */
  settledAt?: string
}
export interface CustomerRef {
  id: string
  status: 'provisioning' | 'ready' | 'failed'
  address: string | null
  /** Cents we have asked Vaaya to move into this wallet, confirmed or not. */
  fundedCents: number
  /** Funding operation ids we have submitted, so retries reuse them. */
  fundingOps: string[]
  /** The label (sign-in email) the provider has been told for this wallet. */
  label?: string
  updatedAt: string
}
export interface Account {
  sub: string
  email: string
  name: string
  createdAt: string
  /** Fixed at sign-up from the visitor's country. Accounts from before
   *  currencies existed are rupee accounts. */
  currency: Currency
  /** Minor units of `currency`. */
  balance: number
  entries: Entry[]
  pending: Pending[]
  /** Stripe Checkout sessions already credited. Never trimmed: a trimmed id
   *  could credit twice. */
  topUps?: string[]
  /** Free resume reads in the last day. */
  parses?: string[]
  /** The user's own Vaaya identity + x402 wallet, when managed customers are on. */
  customer?: CustomerRef
  /** Hash of the network the account was created from (see ipgate.ts). */
  network?: string
}

const path = (sub: string) => `users/${sub}.json`

/** Blobs written before currencies existed carry `balancePaise` and entries
 *  in `paise`. Read both shapes; every write saves the new one. */
function normalize(raw: Record<string, unknown>): Account {
  const a = raw as unknown as Account & { balancePaise?: number }
  if (typeof a.balance !== 'number') a.balance = typeof a.balancePaise === 'number' ? a.balancePaise : 0
  delete a.balancePaise
  if (a.currency !== 'inr' && a.currency !== 'usd') a.currency = 'inr'
  a.entries = (Array.isArray(a.entries) ? a.entries : []).map((e) => {
    const old = e as Entry & { paise?: number }
    return { at: old.at, kind: old.kind, amount: typeof old.amount === 'number' ? old.amount : (old.paise ?? 0), note: old.note }
  })
  if (!Array.isArray(a.pending)) a.pending = []
  return a
}

async function load(sub: string): Promise<{ account: Account; etag: string } | null> {
  const blob = await get(path(sub), { access: 'private', useCache: false })
  if (!blob) return null
  const text = await new Response(blob.stream).text()
  // The CDN sometimes hands back a weak validator (W/"…"); the store's
  // ifMatch only accepts the strong form.
  const etag = (blob.headers?.get('etag') ?? blob.headers?.get('ETag') ?? '').replace(/^W\//, '')
  return { account: normalize(JSON.parse(text) as Record<string, unknown>), etag }
}

async function save(account: Account, etag: string | null): Promise<void> {
  const body = JSON.stringify(account)
  await put(path(account.sub), body, {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    ...(etag ? { ifMatch: etag } : {}),
  })
}

export class InsufficientBalance extends Error {
  constructor(public balance: number, public need: number) {
    super('insufficient_balance')
  }
}

/** The visitor's currency from Vercel's geo header; the default off-platform. */
export async function visitorCurrency(): Promise<Currency> {
  try {
    const h = await headers()
    return currencyForCountry(h.get('x-vercel-ip-country'), DEFAULT_CURRENCY)
  } catch {
    return DEFAULT_CURRENCY
  }
}

/** Get or create the account. New accounts start with the welcome credit in
 *  their currency, unless the sign-in gate withheld it (a repeat network). */
export async function ensureAccount(
  who: { sub: string; email: string; name: string },
  opts: { noWelcome?: boolean; network?: string; currency?: Currency } = {},
): Promise<Account> {
  const found = await load(who.sub)
  if (found) return found.account
  const currency = opts.currency ?? (await visitorCurrency())
  const welcome = opts.noWelcome ? 0 : WELCOME[currency]
  const at = new Date().toISOString()
  const account: Account = {
    sub: who.sub,
    email: who.email,
    name: who.name,
    createdAt: at,
    currency,
    balance: welcome,
    entries: [
      welcome > 0
        ? { at, kind: 'credit', amount: welcome, note: 'Welcome credit' }
        : { at, kind: 'credit', amount: 0, note: 'No welcome credit: this network already has an account' },
    ],
    pending: [],
    ...(opts.network ? { network: opts.network } : {}),
  }
  try {
    await put(path(who.sub), JSON.stringify(account), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    })
    return account
  } catch {
    // Lost the race with a parallel first request: read what won.
    const again = await load(who.sub)
    if (again) return again.account
    throw new Error('ledger_create_failed')
  }
}

export async function getAccount(sub: string): Promise<Account | null> {
  return (await load(sub))?.account ?? null
}

async function mutate(sub: string, fn: (a: Account) => void): Promise<Account> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await load(sub)
    if (!found) throw new Error('no_account')
    const next = structuredClone(found.account)
    fn(next)
    try {
      await save(next, found.etag || null)
      return next
    } catch (err) {
      const stale = err instanceof BlobPreconditionFailedError || /precondition/i.test(String((err as Error)?.message ?? ''))
      if (!stale || attempt === 3) throw err
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
    }
  }
  throw new Error('ledger_contention')
}

function log(a: Account, kind: Entry['kind'], amount: number, note: string) {
  a.entries.unshift({ at: new Date().toISOString(), kind, amount, note })
  a.entries = a.entries.slice(0, 200)
}

export async function debit(sub: string, amount: number, note: string): Promise<Account> {
  return mutate(sub, (a) => {
    if (a.balance < amount) throw new InsufficientBalance(a.balance, amount)
    a.balance -= amount
    log(a, 'debit', amount, note)
  })
}

export async function credit(sub: string, amount: number, note: string): Promise<Account> {
  return mutate(sub, (a) => {
    a.balance += amount
    log(a, 'credit', amount, note)
  })
}

/** Credit a paid Stripe Checkout session. The webhook and the return page
 *  both call this, so it credits each session exactly once. */
export async function creditTopUp(sub: string, sessionId: string, amount: number, note: string): Promise<{ account: Account; credited: boolean }> {
  let credited = false
  const account = await mutate(sub, (a) => {
    a.topUps ??= []
    if (a.topUps.includes(sessionId)) return
    a.topUps.unshift(sessionId)
    a.balance += amount
    log(a, 'credit', amount, note)
    credited = true
  })
  return { account, credited }
}

const DAY = 86400000

/** Count one free resume read. False when today's allowance is spent; a
 *  refused read writes nothing. */
export async function takeParse(sub: string, now = Date.now()): Promise<boolean> {
  const recent = (list: string[] | undefined) => (list ?? []).filter((t) => now - Date.parse(t) < DAY)
  const current = await getAccount(sub)
  if (current && recent(current.parses).length >= PARSES_PER_DAY) return false
  let allowed = false
  await mutate(sub, (a) => {
    const list = recent(a.parses)
    allowed = list.length < PARSES_PER_DAY
    if (allowed) a.parses = [new Date(now).toISOString(), ...list]
  })
  return allowed
}

export async function addPending(sub: string, paise: number, utr: string): Promise<Account> {
  return mutate(sub, (a) => {
    a.pending.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), paise, utr, status: 'pending' })
    a.pending = a.pending.slice(0, 50)
  })
}

/** Paise auto-credited to this account in the last 24 hours. */
export function autoCreditedToday(a: Account, now = Date.now()): number {
  return a.pending
    .filter((p) => p.auto && p.status === 'approved' && now - Date.parse(p.at) < DAY)
    .reduce((sum, p) => sum + p.paise, 0)
}

/** Record the reference AND credit it in one write (the instant path). */
export async function addApproved(sub: string, paise: number, utr: string): Promise<{ account: Account; id: string }> {
  const id = crypto.randomUUID()
  const account = await mutate(sub, (a) => {
    const at = new Date().toISOString()
    a.pending.unshift({ id, at, paise, utr, status: 'approved', auto: true, settledAt: at })
    a.pending = a.pending.slice(0, 50)
    a.balance += paise
    log(a, 'credit', paise, `UPI recharge (UTR ${utr})`)
  })
  return { account, id }
}

/** Take an approved recharge back (a reference that turned out not to be a
 *  payment). The balance never goes below zero; whatever was already spent
 *  stays spent and is noted. */
export async function reverseApproved(sub: string, id: string): Promise<Account> {
  return mutate(sub, (a) => {
    const p = a.pending.find((x) => x.id === id)
    if (!p || p.status !== 'approved') throw new Error('not_approved')
    p.status = 'reversed'
    p.settledAt = new Date().toISOString()
    const taken = Math.min(a.balance, p.paise)
    a.balance -= taken
    log(a, 'debit', taken, `Recharge reversed (UTR ${p.utr})${taken < p.paise ? ', part already spent' : ''}`)
  })
}

/** Record (or refresh) the user's Vaaya customer on their account. */
export async function setCustomer(sub: string, customer: CustomerRef): Promise<Account> {
  return mutate(sub, (a) => {
    a.customer = customer
  })
}

export async function settlePending(sub: string, id: string, status: 'approved' | 'rejected'): Promise<Account> {
  return mutate(sub, (a) => {
    const p = a.pending.find((x) => x.id === id)
    if (!p || p.status !== 'pending') throw new Error('not_pending')
    p.status = status
    p.settledAt = new Date().toISOString()
    if (status === 'approved') {
      a.balance += p.paise
      log(a, 'credit', p.paise, `UPI recharge (UTR ${p.utr})`)
    }
  })
}
