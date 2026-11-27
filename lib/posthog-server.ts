// Product events from the server, for the steps the browser never sees: a
// new account, and a payment Stripe confirmed. Same PostHog project as the
// browser (its public key can only write). distinct_id is the sign-in email,
// which is what the browser identifies with (app/header.tsx). Production only,
// best-effort, and never slows a request by more than a moment.
import { POSTHOG_KEY } from './analytics'

export async function captureServer(event: string, distinctId: string, properties: Record<string, unknown> = {}): Promise<void> {
  if (process.env.VERCEL_ENV !== 'production' || !distinctId) return
  try {
    await fetch('https://us.i.posthog.com/i/v0/e/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: POSTHOG_KEY, event, distinct_id: distinctId, properties: { ...properties, $lib: 'job-hunter-server' } }),
      signal: AbortSignal.timeout(2500),
    })
  } catch (err) {
    console.error('[posthog] capture failed', event, String(err))
  }
}
