// Per-user money, one private JSON blob per user. Writes are optimistic:
// read with the ETag, write with ifMatch, retry on a precondition failure.
// Amounts are integer paise. Nothing here ever goes negative.
import { BlobPreconditionFailedError, get, put } from '@vercel/blob'
import { START_CREDIT_PAISE } from './env'

export interface Entry { at: string; kind: 'credit' | 'debit'; paise: number; note: string }
export interface Pending { id: string; at: string; paise: number; utr: string; status: 'pending' | 'approved' | 'rejected' }
export interface CustomerRef {
  id: string
  status: 'provisioning' | 'ready' | 'failed'
  address: string | null
  /** Cents we have asked Vaaya to move into this wallet, confirmed or not. */
  fundedCents: number
  /** Funding operation ids we have submitted, so retries reuse them. */
  fundingOps: string[]
  updatedAt: string
}
export interface Account {
  sub: string
  email: string
  name: string
  createdAt: string
  balancePaise: number
  entries: Entry[]
  pending: Pending[]
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
  constructor(public balancePaise: number, public needPaise: number) {
    super('insufficient_balance')
  }
}

/** Get or create the account. New accounts start with the welcome credit
 *  unless the sign-in gate withheld it (a repeat network gets ₹0). */
export async function ensureAccount(
  who: { sub: string; email: string; name: string },
  opts: { welcomePaise?: number; network?: string } = {},
): Promise<Account> {
  const found = await load(who.sub)
  if (found) return found.account
  const welcome = opts.welcomePaise ?? START_CREDIT_PAISE
  const account: Account = {
    sub: who.sub,
    email: who.email,
    name: who.name,
    createdAt: new Date().toISOString(),
    balancePaise: welcome,
    entries: [
      welcome > 0
        ? { at: new Date().toISOString(), kind: 'credit', paise: welcome, note: 'Welcome credit' }
        : { at: new Date().toISOString(), kind: 'credit', paise: 0, note: 'No welcome credit: this network already has an account' },
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

export function canAfford(account: Account, paise: number): boolean {
  return account.balancePaise >= paise
}

export async function debit(sub: string, paise: number, note: string): Promise<Account> {
  return mutate(sub, (a) => {
    if (a.balancePaise < paise) throw new InsufficientBalance(a.balancePaise, paise)
    a.balancePaise -= paise
    a.entries.unshift({ at: new Date().toISOString(), kind: 'debit', paise, note })
    a.entries = a.entries.slice(0, 200)
  })
}

export async function credit(sub: string, paise: number, note: string): Promise<Account> {
  return mutate(sub, (a) => {
    a.balancePaise += paise
    a.entries.unshift({ at: new Date().toISOString(), kind: 'credit', paise, note })
    a.entries = a.entries.slice(0, 200)
  })
}

export async function addPending(sub: string, paise: number, utr: string): Promise<Account> {
  return mutate(sub, (a) => {
    a.pending.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), paise, utr, status: 'pending' })
    a.pending = a.pending.slice(0, 50)
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
    if (status === 'approved') {
      a.balancePaise += p.paise
      a.entries.unshift({ at: new Date().toISOString(), kind: 'credit', paise: p.paise, note: `UPI recharge (UTR ${p.utr})` })
    }
  })
}
