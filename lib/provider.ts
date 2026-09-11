// The only file that talks to the data backend, with the operator's key.
import { PROVIDER_API_KEY, PROVIDER_URL } from './env'

export interface ProviderOk<T> { ok: true; data: T }
export interface ProviderErr { ok: false; code: string; message: string }
export type ProviderResult<T> = ProviderOk<T> | ProviderErr

async function call(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${PROVIDER_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${PROVIDER_API_KEY}`,
      'content-type': 'application/json',
      'x-vaaya-agent': 'job-hunter',
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
  return { ok: false, code: 'upstream', message: 'That step did not go through. Nothing was charged. Try again in a minute.' }
}

/** One catalog call, capped at maxCostCents. */
export async function run<T>(service: string, action: string, params: Record<string, unknown>, maxCostCents: number): Promise<ProviderResult<T>> {
  const { status, body } = await call(`/api/run/${service}/${action}`, { ...params, max_cost_cents: maxCostCents })
  if (status < 400 && body.ok) return { ok: true, data: body.data as T }
  return fail(status, body)
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
