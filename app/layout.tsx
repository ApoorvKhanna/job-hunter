import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const sans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Job Hunter',
  description: 'Upload your resume. Get matching jobs, the person hiring, their email, and a note you can send. ₹49 to start.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
