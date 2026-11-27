import { notFound, redirect } from 'next/navigation'
import { ensureAccount, walletOf } from '@/lib/ledger'
import { REVIEW_PRICE } from '@/lib/prices'
import { recoverStale } from '@/lib/review'
import { getReview } from '@/lib/review-store'
import { readSession } from '@/lib/session'
import { payConfig } from '@/lib/stripe'
import Preview from '../preview'
import Report from '../report'

export const dynamic = 'force-dynamic'

export default async function ReviewReport({ params }: { params: Promise<{ id: string }> }) {
  const session = await readSession()
  if (!session) redirect('/')
  const { id } = await params
  const [found, account] = await Promise.all([getReview(session.sub, id), ensureAccount(session)])
  if (!found) notFound()
  const review = await recoverStale(found)
  // Not finished yet: the review page knows how to wait on it.
  if (review.status === 'running') redirect(`/review?review=${review.id}&wait=1`)
  // Not paid for yet, with a free scan: show the scan and the offer.
  if ((review.status === 'draft' || review.status === 'failed') && review.preview) {
    const scan = review.preview.scan
    const seen = new Set([...scan.fixations.map((f) => f.id), ...scan.missed.map((m) => m.id)])
    return (
      <Preview
        email={session.email}
        wallet={walletOf(account)}
        currency={account.currency}
        price={REVIEW_PRICE[account.currency]}
        pay={payConfig()}
        review={{
          id: review.id,
          at: review.createdAt,
          fileName: review.input.fileName,
          roles: review.input.roles,
          profiles: Object.keys(review.input.links).length,
          pages: review.input.pages.map((p) => ({ n: p.n, width: p.width, height: p.height, image: p.image, blocks: p.blocks.filter((b) => seen.has(b.id)) })),
          // The fixes stay here: the free scan shows what is skipped, not how to fix it.
          scan: {
            score: scan.score,
            six_seconds: scan.six_seconds,
            fixations: scan.fixations,
            seen: scan.seen,
            missed: scan.missed.map((m) => ({ id: m.id, what: m.what })),
            layoutFixes: scan.layout.length,
            method: scan.method,
          },
        }}
      />
    )
  }
  if (review.status !== 'done' || !review.result) redirect('/review')

  // Only the lines the report draws on, not the whole layout.
  const used = new Set([...review.result.scan.fixations.map((f) => f.id), ...review.result.scan.missed.map((m) => m.id)])
  return (
    <Report
      email={session.email}
      wallet={walletOf(account)}
      currency={account.currency}
      price={REVIEW_PRICE[account.currency]}
      pay={payConfig()}
      review={{
        id: review.id,
        at: review.createdAt,
        fileName: review.input.fileName,
        roles: review.input.roles,
        links: review.input.links,
        pages: review.input.pages.map((p) => ({ n: p.n, width: p.width, height: p.height, image: p.image, blocks: p.blocks.filter((b) => used.has(b.id)) })),
        result: review.result,
      }}
    />
  )
}
