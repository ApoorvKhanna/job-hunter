import type { MetadataRoute } from 'next'

const BASE = 'https://thejobhunter.in'

// Only public pages. /jobs and /review need a signed-in account and redirect a
// visitor to /, so Search Console flagged them "Page with redirect" (2026-11-28).
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${BASE}/`, changeFrequency: 'weekly', priority: 1 }]
}
