import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/admin', '/saved'] },
    sitemap: 'https://thejobhunter.in/sitemap.xml',
  }
}
