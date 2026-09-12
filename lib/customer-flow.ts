// Where the customer wallet meets the app's own rupee ledger.
//
// Two ledgers, on purpose. The rupee balance in Blob is what the USER may
// spend and is the source of truth for the product. The Vaaya customer wallet
// is what WE spend on their behalf, attributed to them. If the wallet is
// missing, unfunded, provisioning, or the feature is off, the call simply
// settles on the operator key as it always has. A user is never blocked by
// wallet plumbing they cannot see.
import { CUSTOMER_WELCOME_CENTS } from './env'
import {
  CustomerError,
  type Customer,
  customersEnabled,
  ensureCustomer,
  fundCustomer,
  getCustomer,
  getFunding,
} from './customer'
import { type Account, type CustomerRef, getAccount, setCustomer } from './ledger'

function ref(c: Customer, prev?: CustomerRef): CustomerRef {
  return {
    id: c.id,
    status: c.status,
    address: c.wallet?.address ?? null,
    fundedCents: Math.max(prev?.fundedCents ?? 0, c.funded_cents ?? 0),
    fundingOps: prev?.fundingOps ?? [],
    updatedAt: new Date().toISOString(),
  }
}

/** Login-time: make sure this user has a Vaaya customer. Never throws. */
export async function attachCustomer(sub: string): Promise<CustomerRef | null> {
  if (!customersEnabled()) return null
  try {
    const existing = (await getAccount(sub))?.customer
    if (existing?.status === 'ready') return existing
    const c = await ensureCustomer(sub)
    const next = ref(c, existing)
    await setCustomer(sub, next)
    console.log('[customer] ensured', JSON.stringify({ sub, id: c.id, status: c.status, address: c.wallet?.address }))
    return next
  } catch (err) {
    // 503 customers_not_enabled is the expected answer until the backend
    // owner flips the flag. Log once per login, keep the user moving.
    const e = err as CustomerError
    console.log('[customer] unavailable', JSON.stringify({ sub, code: e.code ?? 'error', status: e.status ?? 0 }))
    return null
  }
}

/** Refresh a provisioning customer's status. Cheap, read-only on Vaaya. */
export async function refreshCustomer(account: Account): Promise<CustomerRef | null> {
  const cur = account.customer
  if (!cur || cur.status === 'ready') return cur ?? null
  try {
    const c = await getCustomer(cur.id)
    const next = ref(c, cur)
    if (next.status !== cur.status || next.address !== cur.address) await setCustomer(account.sub, next)
    return next
  } catch {
    return cur
  }
}

/** Before the first customer-settled call: move the welcome amount in. Waits
 *  briefly for confirmation; if it is still pending we let THIS call settle on
 *  the operator key and try the wallet again next time. Never throws. */
export async function ensureFunded(account: Account): Promise<boolean> {
  const cur = account.customer
  if (!cur || cur.status !== 'ready') return false
  if (cur.fundedCents > 0) return true
  const opKey = `welcome:${account.sub}`
  try {
    const f = await fundCustomer(cur.id, CUSTOMER_WELCOME_CENTS, opKey)
    const ops = cur.fundingOps.includes(f.id) ? cur.fundingOps : [...cur.fundingOps, f.id]
    let status = f.status
    // Up to ~6s of polling. Funding is an on-chain transfer; confirmation is
    // usually fast but never instant.
    for (let i = 0; i < 6 && status === 'pending'; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      status = (await getFunding(cur.id, f.id)).status
    }
    const confirmed = status === 'confirmed'
    await setCustomer(account.sub, {
      ...cur,
      fundedCents: confirmed ? CUSTOMER_WELCOME_CENTS : cur.fundedCents,
      fundingOps: ops,
      updatedAt: new Date().toISOString(),
    })
    console.log('[customer] welcome funding', JSON.stringify({ sub: account.sub, op: f.id, status }))
    return confirmed
  } catch (err) {
    const e = err as CustomerError
    console.log('[customer] funding failed', JSON.stringify({ sub: account.sub, code: e.code ?? 'error', status: e.status ?? 0 }))
    return false
  }
}

/** Admin approved a rupee recharge: mirror it into the wallet at ₹1 ≈ 1¢.
 *  Keyed by the pending-recharge id so a double click cannot double fund. */
export async function topUpCustomer(sub: string, paise: number, opKey: string): Promise<void> {
  if (!customersEnabled()) return
  const account = await getAccount(sub)
  const cur = account?.customer
  if (!cur || cur.status !== 'ready') return
  const cents = Math.max(1, Math.round(paise / 100))
  try {
    const f = await fundCustomer(cur.id, cents, `recharge:${opKey}`)
    await setCustomer(sub, {
      ...cur,
      fundedCents: cur.fundedCents + (f.status === 'failed' ? 0 : cents),
      fundingOps: cur.fundingOps.includes(f.id) ? cur.fundingOps : [...cur.fundingOps, f.id],
      updatedAt: new Date().toISOString(),
    })
    console.log('[customer] top-up', JSON.stringify({ sub, cents, op: f.id, status: f.status }))
  } catch (err) {
    const e = err as CustomerError
    console.log('[customer] top-up failed', JSON.stringify({ sub, code: e.code ?? 'error' }))
  }
}
