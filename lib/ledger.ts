// Per-user money, one private JSON blob per user. Writes are optimistic:
// read with the ETag, write with ifMatch, retry on a precondition failure.
// Amounts are integer US cents. Nothing here ever goes negative.
import { BlobPreconditionFailedError, get, put } from '@vercel/blob'
import { PARSES_PER_DAY, START_CREDIT_CENTS } from './env'

export interface Entry { at: string; kind: 'credit' | 'debit'; cents: number; note: string }
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
  balanceCents: number
  entries: Entry[]
  /** Stripe Checkout sessions already credited, so a session credits once. */
  topUps: string[]
  /** When this account's recent free resume reads ran (last 24 hours). */
  parses?: string[]
  /** The user's own Vaaya identity + x402 wallet, when managed customers are on. */
  customer?: CustomerRef
  /** Hash of the network the account was created from (see ipgate.ts). */
  network?: string
}

const path = (sub: string) => `users/${sub}.json`

async function load(sub: string): Promise<{ account: Account; etag: string } | null> {
  const blob = await get(path(sub), { access: 'private', useCache: false })
  if (!blob) return null
  const text = await new Response(blob.stream).text()
  // The CDN sometimes hands back a weak validator (W/"…"); the store's
  // ifMatch only accepts the strong form.
  const etag = (blob.headers?.get('etag') ?? blob.headers?.get('ETag') ?? '').replace(/^W\//, '')
  return { account: JSON.parse(text) as Account, etag }
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
  constructor(public balanceCents: number, public needCents: number) {
    super('insufficient_balance')
  }
}

/** Get or create the account. New accounts start with the welcome credit
 *  unless the sign-in gate withheld it (a repeat network gets none). */
export async function ensureAccount(
  who: { sub: string; email: string; name: string },
  opts: { welcomeCents?: number; network?: string } = {},
): Promise<Account> {
  const found = await load(who.sub)
  if (found) return found.account
  const welcome = opts.welcomeCents ?? START_CREDIT_CENTS
  const account: Account = {
    sub: who.sub,
    email: who.email,
    name: who.name,
    createdAt: new Date().toISOString(),
    balanceCents: welcome,
    entries: welcome > 0 ? [{ at: new Date().toISOString(), kind: 'credit', cents: welcome, note: 'Welcome credit' }] : [],
    topUps: [],
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

export async function debit(sub: string, cents: number, note: string): Promise<Account> {
  return mutate(sub, (a) => {
    if (a.balanceCents < cents) throw new InsufficientBalance(a.balanceCents, cents)
    a.balanceCents -= cents
    a.entries.unshift({ at: new Date().toISOString(), kind: 'debit', cents, note })
    a.entries = a.entries.slice(0, 200)
  })
}

export async function credit(sub: string, cents: number, note: string): Promise<Account> {
  return mutate(sub, (a) => {
    a.balanceCents += cents
    a.entries.unshift({ at: new Date().toISOString(), kind: 'credit', cents, note })
    a.entries = a.entries.slice(0, 200)
  })
}

/** Credit a paid Stripe Checkout session. The webhook and the return page
 *  both call this, so it credits each session exactly once. */
export async function creditTopUp(sub: string, sessionId: string, cents: number): Promise<{ account: Account; credited: boolean }> {
  let credited = false
  const account = await mutate(sub, (a) => {
    a.topUps ??= []
    if (a.topUps.includes(sessionId)) return
    a.topUps.unshift(sessionId)
    a.topUps = a.topUps.slice(0, 200)
    a.balanceCents += cents
    a.entries.unshift({ at: new Date().toISOString(), kind: 'credit', cents, note: 'Card top-up' })
    a.entries = a.entries.slice(0, 200)
    credited = true
  })
  return { account, credited }
}

/** Count one free resume read. False when today's allowance is spent. */
export async function takeParse(sub: string, now = Date.now()): Promise<boolean> {
  let allowed = false
  await mutate(sub, (a) => {
    const recent = (a.parses ?? []).filter((t) => now - Date.parse(t) < 86400000)
    allowed = recent.length < PARSES_PER_DAY
    a.parses = allowed ? [new Date(now).toISOString(), ...recent] : recent
  })
  return allowed
}

/** Record (or refresh) the user's Vaaya customer on their account. */
export async function setCustomer(sub: string, customer: CustomerRef): Promise<Account> {
  return mutate(sub, (a) => {
    a.customer = customer
  })
}
