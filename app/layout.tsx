import type { Metadata } from 'next'
import { MAX_JOBS, RUN_CENTS, usd } from '@/lib/prices'
import { Cormorant_Garamond, Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const sans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })
const serif = Cormorant_Garamond({ variable: '--font-serif', subsets: ['latin'], weight: ['500', '600', '700'], style: ['normal', 'italic'] })

export const metadata: Metadata = {
  title: 'Job Hunter',
  description: `Upload your resume and see up to ${MAX_JOBS} fresh job postings that fit, the people hiring at each company, their email, and a first draft written from your experience. ${usd(RUN_CENTS)} a run, free if no jobs are found`,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  )
}
