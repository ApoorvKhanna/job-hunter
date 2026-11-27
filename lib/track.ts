'use client'

// Product events to PostHog, from the browser only (lib/analytics.ts gates
// it to the live site). Keep the names stable: they are what the funnel is
// measured with.
//   paywall_shown     the packs sheet opened: { reason, from, emails, deep }
//   checkout_opened   Pay was clicked: { pack, amount, currency, reason }
//   search_done       a search came back: { jobs, deep, left }
//   email_found       an email was revealed: { paid_with }
//   review_preview    a free review scan came back: { score }
import posthog from 'posthog-js'
import { analyticsOn } from './analytics'

export function track(event: string, props?: Record<string, unknown>): void {
  if (!analyticsOn()) return
  try {
    posthog.capture(event, props)
  } catch {}
}
