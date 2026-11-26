import type { MetadataRoute } from 'next'

const BASE = 'https://thejobhunter.in'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/jobs`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/review`, changeFrequency: 'weekly', priority: 0.8 },
  ]
}
