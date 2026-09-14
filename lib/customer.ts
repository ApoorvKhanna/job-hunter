// Vaaya managed customers, over REST with the operator key.
//
// What this gives us: every signed-in user becomes a distinct Vaaya identity
// with its own x402 wallet address, funded explicitly from our prepaid balance.
// Paid calls made with that customer's token settle from that wallet, so cost
// is attributed per person. See docs/SDK-CUSTOMERS.md in the Vaaya repo.
//
// What it cannot do yet (backend fails closed, 422): the LLM router and the
// routed people-finder. Those stay on the operator key; see provider.ts.
import { CUSTOMER_BUDGET_CENTS, CUSTOMERS_ENABLED, OWNER_API_KEY, PROVIDER_URL } from './env'

export interface Customer {
  id: string
  external_id: string
  status: 'provisioning' | 'ready' | 'failed'
  paused: boolean
  budget_cents: number | null
  funded_cents: number
  spent_cents: number
  reserved_cents: number
  wallet: { address: string | null; status: string }
}
export interface Funding {
  id: string
  status: 'pending' | 'confirmed' | 'failed' | 'needs_review'
  amount_cents: number
}

export class CustomerError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function owner(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${PROVIDER_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${OWNER_API_KEY}`,
      'content-type': 'application/json',
      'x-vaaya-agent': 'job-hunter',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new CustomerError(String(json.error ?? `http_${res.status}`), String(json.message ?? ''), res.status)
  }
  return json
}

export const customersEnabled = () => CUSTOMERS_ENABLED && !!OWNER_API_KEY

/** Create or fetch the customer for this external id. Idempotent on the server. */
/** Create or fetch the user's customer. `label` is what the operator sees
 *  for this wallet on the provider's side (we send the sign-in email). */
export async function ensureCustomer(externalId: string, label?: string): Promise<Customer> {
  return (await owner('POST', '/api/v1/customers/ensure', {
    external_id: externalId,
    budget_cents: CUSTOMER_BUDGET_CENTS,
    ...(label ? { label } : {}),
  })) as unknown as Customer
}

export async function getCustomer(id: string): Promise<Customer> {
  return (await owner('GET', `/api/v1/customers/${encodeURIComponent(id)}`)) as unknown as Customer
}

/** Move `cents` from our prepaid balance into the customer wallet. The key
 *  makes it safe to retry: same key + same amount returns the same operation. */
export async function fundCustomer(id: string, cents: number, idempotencyKey: string): Promise<Funding> {
  return (await owner('POST', `/api/v1/customers/${encodeURIComponent(id)}/fund`, { amount_cents: cents }, { 'idempotency-key': idempotencyKey })) as unknown as Funding
}

export async function getFunding(id: string, operationId: string): Promise<Funding> {
  return (await owner('GET', `/api/v1/customers/${encodeURIComponent(id)}/funding/${encodeURIComponent(operationId)}`)) as unknown as Funding
}

// One-hour tokens, cached for fifty-five minutes per customer. The function
// instance is ephemeral on Vercel, so a cold start simply mints again.
const tokens = new Map<string, { token: string; until: number }>()

export async function customerToken(id: string): Promise<string> {
  const hit = tokens.get(id)
  if (hit && hit.until > Date.now()) return hit.token
  const out = (await owner('POST', `/api/v1/customers/${encodeURIComponent(id)}/access`, {})) as { token: string; expires_at: string }
  tokens.set(id, { token: out.token, until: Date.now() + 55 * 60 * 1000 })
  return out.token
}

export function forgetToken(id: string) {
  tokens.delete(id)
}
