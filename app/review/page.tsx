import { redirect } from 'next/navigation'
import { ensureAccount } from '@/lib/ledger'
import { REVIEW_PRICE } from '@/lib/prices'
import { validId } from '@/lib/review-store'
import { listSaved } from '@/lib/saved'
import { readSession } from '@/lib/session'
import { payConfig, settleReturn } from '@/lib/stripe'
import ReviewFlow from './review-flow'

export const dynamic = 'force-dynamic'

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ topup?: string; review?: string; wait?: string }> }) {
  const session = await readSession()
  if (!session) redirect('/')
  await ensureAccount(session)
  const { topup, review, wait } = await searchParams
  const notice = await settleReturn(session.sub, topup)
  const [account, items] = await Promise.all([ensureAccount(session), listSaved(session.sub)])
  const past = items.flatMap((i) => (i.kind === 'review' ? [{ id: i.id, at: i.at, roles: i.roles, overall: i.overall, headline: i.headline }] : []))
  const lastLinks = items.find((i) => i.kind === 'review')
  return (
    <ReviewFlow
      email={session.email}
      balance={account.balance}
      currency={account.currency}
      price={REVIEW_PRICE[account.currency]}
      pay={payConfig()}
      notice={notice}
      past={past}
      lastLinks={lastLinks?.kind === 'review' ? lastLinks.links : {}}
      // Back from paying for this review, or sent here to wait for one that is
      // running. A bare ?review= never starts (and charges) anything.
      resumeId={review && validId(review) && (topup || wait) ? review : null}
    />
  )
}
