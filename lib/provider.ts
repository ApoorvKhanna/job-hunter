// The only file that talks to the data backend, with the operator's key.
import { PROVIDER_API_KEY, PROVIDER_URL } from './env'
import { customerToken, forgetToken } from './customer'
import { ensureFunded, refreshCustomer } from './customer-flow'
import type { Account } from './ledger'

export interface ProviderOk<T> { ok: true; data: T }
export interface ProviderErr { ok: false; code: string; message: string; /** the provider's own code, for logs and fallbacks; never shown */ detail?: string }
export type ProviderResult<T> = ProviderOk<T> | ProviderErr

async function call(
  path: string,
  body: unknown,
  auth: { token: string; idempotencyKey?: string } = { token: PROVIDER_API_KEY },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${PROVIDER_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${auth.token}`,
      'content-type': 'application/json',
      'x-vaaya-agent': 'job-hunter',
      ...(auth.idempotencyKey ? { 'idempotency-key': auth.idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  })
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, body: parsed }
}

function fail(status: number, body: Record<string, unknown>): ProviderErr {
  const nested = (body.data && typeof body.data === 'object' ? body.data : null) as Record<string, unknown> | null
  const errObj = (body.error && typeof body.error === 'object' ? body.error : null) as Record<string, unknown> | null
  const src = nested ?? errObj ?? body
  const code = String(src.code ?? src.error ?? `http_${status}`)
  // Operator-side problems (empty operator balance, bad key) must never leak
  // upstream copy to the user. The user sees one neutral line; the real
  // reason goes to the logs.
  console.error('[provider]', status, code, src.message)
  return { ok: false, code: 'upstream', message: 'That step did not go through. Nothing was charged. Try again in a minute.', detail: code }
}

/** One catalog call, capped at maxCostCents. */
export async function run<T>(service: string, action: string, params: Record<string, unknown>, maxCostCents: number): Promise<ProviderResult<T>> {
  const { status, body } = await call(`/api/run/${service}/${action}`, { ...params, max_cost_cents: maxCostCents })
  if (status < 400 && body.ok) return { ok: true, data: body.data as T }
  return fail(status, body)
}

/** The same catalog call, settled on the USER's own Vaaya wallet when they
 *  have one. Anything the customer path cannot do — feature off, wallet not
 *  ready, unfunded, an unsupported action, an expired token, a short balance —
 *  falls through to the operator key exactly as `run` does. The user sees no
 *  difference; the ledger on Vaaya's side sees who actually spent. */
export async function runFor<T>(
  account: Account,
  service: string,
  action: string,
  params: Record<string, unknown>,
  maxCostCents: number,
): Promise<ProviderResult<T> & { settledBy?: 'customer' | 'operator' }> {
  const cust = await refreshCustomer(account)
  if (cust?.status === 'ready') {
    const funded = cust.fundedCents > 0 || (await ensureFunded({ ...account, customer: cust }))
    if (funded) {
      try {
        const token = await customerToken(cust.id)
        const { status, body } = await call(
          `/api/run/${service}/${action}`,
          { ...params, max_cost_cents: maxCostCents },
          { token, idempotencyKey: crypto.randomUUID() },
        )
        if (status < 400 && body.ok) return { ok: true, data: body.data as T, settledBy: 'customer' }
        // Provider-side failure (bad params, upstream down) is the same on
        // either key: do not retry it on the operator's dime.
        const code = String(((body.data as Record<string, unknown> | undefined)?.code ?? body.error ?? '') as string)
        const customerSide = status === 401 || status === 402 || status === 409 || status === 422 || /customer|wallet|idempotency|budget/i.test(code)
        if (!customerSide) return fail(status, body)
        if (status === 401) forgetToken(cust.id)
        console.log('[customer] fell back', JSON.stringify({ sub: account.sub, service, action, status, code }))
      } catch (err) {
        console.log('[customer] fell back', JSON.stringify({ sub: account.sub, service, action, error: String(err).slice(0, 120) }))
      }
    }
  }
  const out = await run<T>(service, action, params, maxCostCents)
  return out.ok ? { ...out, settledBy: 'operator' } : out
}

/** One chat completion through the OpenAI-compatible router. */
export async function chat(messages: Array<{ role: 'system' | 'user'; content: string }>, maxTokens = 700): Promise<ProviderResult<string>> {
  const { status, body } = await call('/api/llm/v1/chat/completions', {
    model: 'anthropic/claude-haiku-4.5',
    messages,
    max_tokens: maxTokens,
    temperature: 0.3,
    stream: false,
  })
  if (status < 400) {
    const choices = body.choices as Array<{ message?: { content?: string } }> | undefined
    return { ok: true, data: choices?.[0]?.message?.content ?? '' }
  }
  return fail(status, body)
}
