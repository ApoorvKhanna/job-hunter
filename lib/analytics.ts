// Analytics for Job Hunter, on apoorvkhanna88@gmail.com: Google Analytics 4
// (account "Apoorv projects", property thejobhunter.in p565965495) for traffic
// and PostHog for product events, sent through our own /ingest path
// (next.config.ts) so ad blockers don't drop it. Both IDs are public by
// design: they ship in the page.

export const GA_MEASUREMENT_ID = 'G-Z4LFELNK79'

/** PostHog project "thejobhunter.in" (id 770195, US cloud, organization "Job Hunter"). The
 *  project token is write-only and meant for public pages. */
export const POSTHOG_KEY = 'phc_tNDnfZFD7w2zgJp9mBzb9bpdMs8P2C9CpUSkm52JB8vQ'
export const POSTHOG_UI_HOST = 'https://us.posthog.com'

/** Analytics runs only on the live site: a production build, in a browser on
 *  thejobhunter.in (or www). Local runs and preview deployments send nothing. */
export function analyticsOn(): boolean {
  if (process.env.NODE_ENV !== 'production') return false
  if (typeof window === 'undefined') return false
  return /(^|\.)thejobhunter\.in$/.test(window.location.hostname)
}
