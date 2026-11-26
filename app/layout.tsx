import type { Metadata } from 'next'
import { Cormorant_Garamond, Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { GoogleAnalytics } from '@/components/GoogleAnalytics'

const sans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })
const serif = Cormorant_Garamond({ variable: '--font-serif', subsets: ['latin'], weight: ['500', '600', '700'], style: ['normal', 'italic'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://thejobhunter.in'),
  title: 'Job Hunter',
  description: 'Find jobs that fit and know who to contact, or see where a recruiter\u2019s eye lands on your resume with a review of your LinkedIn, X, GitHub and site. Free credits to start.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        {children}
        <GoogleAnalytics />
      </body>
    </html>
  )
}
