import { redirect } from 'next/navigation'
import { ensureAccount, walletOf } from '@/lib/ledger'
import { listSaved } from '@/lib/saved'
import { readSession } from '@/lib/session'
import { payConfig, settleReturn } from '@/lib/stripe'
import Home from './home'

export const dynamic = 'force-dynamic'

// The first screen after sign-in: two ways in.
export default async function AppPage({ searchParams }: { searchParams: Promise<{ topup?: string }> }) {
  const session = await readSession()
  if (!session) redirect('/')
  await ensureAccount(session)
  const notice = await settleReturn(session.sub, (await searchParams).topup)
  const [account, items] = await Promise.all([ensureAccount(session), listSaved(session.sub)])
  const reviews = items.filter((i) => i.kind === 'review')
  const last = reviews[0]?.kind === 'review' ? reviews[0] : null
  return (
    <Home
      email={session.email}
      firstName={session.name.split(' ')[0] ?? ''}
      wallet={walletOf(account)}
      currency={account.currency}
      pay={payConfig()}
      notice={notice}
      counts={{
        jobs: items.filter((i) => i.kind === 'job').length,
        drafts: items.filter((i) => i.kind === 'note').length,
        contacts: items.filter((i) => i.kind === 'email').length,
        reviews: reviews.length,
      }}
      lastReview={last ? { id: last.id, at: last.at, roles: last.roles, overall: last.overall } : null}
    />
  )
}
