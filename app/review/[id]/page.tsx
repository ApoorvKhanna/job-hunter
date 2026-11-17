import { notFound, redirect } from 'next/navigation'
import { ensureAccount } from '@/lib/ledger'
import { REVIEW_PRICE } from '@/lib/prices'
import { recoverStale } from '@/lib/review'
import { getReview } from '@/lib/review-store'
import { readSession } from '@/lib/session'
import { payConfig } from '@/lib/stripe'
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
  if (review.status !== 'done' || !review.result) redirect('/review')

  // Only the lines the report draws on, not the whole layout.
  const used = new Set([...review.result.scan.fixations.map((f) => f.id), ...review.result.scan.missed.map((m) => m.id)])
  return (
    <Report
      email={session.email}
      balance={account.balance}
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
