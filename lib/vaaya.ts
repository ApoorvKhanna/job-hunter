// The only file that talks to Vaaya. Every call goes out with the USER's own
// bearer token (never an app-wide key), so each user of this app is their own
// Vaaya account spending their own credit. A 401 triggers one refresh + retry;
// the caller re-sets the cookie when `session` comes back changed.
import { CLIENT_ID, ISSUER } from './env'
import type { Session } from './session'

export interface RunResult<T = unknown> {
  ok: true
  data: T
  chargedCents: number
  balanceCents: number | null
}
export interface RunFailure {
  ok: false
  status: number
  code: string
  message: string
  /** Where the user must go to unblock: the card page or the credits page. */
  url?: string
}
export type Outcome<T> = RunResult<T> | RunFailure

export class VaayaClient {
  session: Session
  changed = false
  constructor(session: Session) {
    this.session = session
  }

  private async refresh(): Promise<boolean> {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.session.refreshToken,
      client_id: CLIENT_ID,
    })
    const res = await fetch(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    if (!res.ok) return false
    const t = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }
    this.session = {
      ...this.session,
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? this.session.refreshToken,
      expiresAt: Date.now() + t.expires_in * 1000,
    }
    this.changed = true
    return true
  }

  private async fetchWithAuth(path: string, init: RequestInit, retry = true): Promise<Response> {
    if (retry && this.session.expiresAt - Date.now() < 60_000) await this.refresh()
    const res = await fetch(`${ISSUER}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${this.session.accessToken}`,
        'x-vaaya-agent': 'jobhunt-agent',
      },
    })
    if (res.status === 401 && retry && (await this.refresh())) {
      return this.fetchWithAuth(path, init, false)
    }
    return res
  }

  /** One paid catalog call: POST /api/run/{service}/{action}. */
  async run<T = unknown>(
    service: string,
    action: string,
    params: Record<string, unknown>,
    maxCostCents: number,
  ): Promise<Outcome<T>> {
    const res = await this.fetchWithAuth(`/api/run/${service}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...params, max_cost_cents: maxCostCents }),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok && body.ok) {
      return {
        ok: true,
        data: body.data as T,
        chargedCents: Number(body.charged_cents ?? 0),
        balanceCents: typeof body.balance_remaining_cents === 'number' ? body.balance_remaining_cents : null,
      }
    }
    return failure(res.status, body)
  }

  /** One LLM completion through Vaaya's OpenAI-compatible router. */
  async chat(messages: Array<{ role: 'system' | 'user'; content: string }>, maxTokens = 700): Promise<Outcome<string>> {
    const res = await this.fetchWithAuth('/api/llm/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
        stream: false,
      }),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.ok) {
      const choices = body.choices as Array<{ message?: { content?: string } }> | undefined
      const text = choices?.[0]?.message?.content ?? ''
      return { ok: true, data: text, chargedCents: 0, balanceCents: null }
    }
    return failure(res.status, body)
  }

  async wallet(): Promise<Outcome<{ email: string | null; availableCents: number; cardOnFile: boolean }>> {
    const res = await this.fetchWithAuth('/api/v1/wallet', { method: 'GET' })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return failure(res.status, body)
    const account = (body.account ?? {}) as { email?: string | null }
    const wallet = (body.wallet ?? {}) as { available_cents?: number; card_on_file?: boolean }
    return {
      ok: true,
      data: {
        email: account.email ?? null,
        availableCents: Number(wallet.available_cents ?? 0),
        cardOnFile: !!wallet.card_on_file,
      },
      chargedCents: 0,
      balanceCents: Number(wallet.available_cents ?? 0),
    }
  }
}

// Vaaya's failure bodies come in two shapes: the /api/run envelope
// ({ok:false, data:{error, code, message, card_url, credits_url}}) and the
// OpenAI-style {error:{code, message, card_url}} from the LLM router.
function failure(status: number, body: Record<string, unknown>): RunFailure {
  const nested = (body.data && typeof body.data === 'object' ? body.data : null) as Record<string, unknown> | null
  const errObj = (body.error && typeof body.error === 'object' ? body.error : null) as Record<string, unknown> | null
  const src = nested ?? errObj ?? body
  const code = String(src.code ?? src.error ?? (typeof body.error === 'string' ? body.error : '') ?? `http_${status}`) || `http_${status}`
  const message = String(src.message ?? src.error_description ?? 'Vaaya returned an error')
  const url = (src.card_url ?? src.credits_url) as string | undefined
  return { ok: false, status, code, message, url }
}
