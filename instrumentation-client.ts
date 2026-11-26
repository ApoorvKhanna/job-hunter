import posthog from 'posthog-js'
import { POSTHOG_KEY, POSTHOG_UI_HOST, analyticsOn } from '@/lib/analytics'

// PostHog starts before the page hydrates, on the live site only. Page changes
// are counted by the defaults' history tracking; exceptions are captured too.
if (analyticsOn()) {
  posthog.init(POSTHOG_KEY, {
    api_host: '/ingest',
    ui_host: POSTHOG_UI_HOST,
    defaults: '2026-01-30',
    capture_exceptions: true,
  })
}
