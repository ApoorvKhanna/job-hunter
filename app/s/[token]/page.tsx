// A shared 6-second scan score. Public, no sign-in: the score and the target
// roles, and one way in. Nothing else about the person is stored or shown.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { getShare, rolesLine } from '@/lib/share-store'

export const dynamic = 'force-dynamic'

const CTA = '/?utm_source=share&utm_medium=card'
const load = cache((token: string) => getShare(token))

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const share = await load(token)
  if (!share) return { title: 'Job Hunter', robots: { index: false, follow: false } }
  const title = `A recruiter’s 6-second scan: ${share.score}/100`
  const roles = rolesLine(share.roles)
  const description = `${roles ? `For ${roles}. ` : ''}See where a recruiter’s eye lands on your resume in the first six seconds. Try yours free.`
  return {
    title: `${title} · Job Hunter`,
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: `/s/${share.token}` },
    // The image itself comes from opengraph-image.tsx and twitter-image.tsx.
    openGraph: { type: 'website', siteName: 'Job Hunter', url: `/s/${share.token}`, title, description },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function SharedScore({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const share = await load(token)
  if (!share) notFound()
  const roles = rolesLine(share.roles)
  return (
    <main className="wrap share-page">
      <nav className="nav">
        <span className="brand">Job Hunter</span>
      </nav>
      <section className="share-card">
        <span className="share-kicker">A recruiter’s 6-second scan</span>
        <div className="share-score">{share.score}<small>/100</small></div>
        {roles ? <p className="share-roles">For {roles}</p> : null}
        <a className="btn" href={CTA}>Get your free 6-second scan</a>
      </section>
      <p className="small muted share-about">
        Job Hunter shows where a recruiter’s eye lands on a resume in the first six seconds: the order they read it in, a
        heatmap, and the strong points they skip. Upload yours and see the scan, free.
      </p>
    </main>
  )
}
