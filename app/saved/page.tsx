import { redirect } from 'next/navigation'
import { ensureAccount, walletOf } from '@/lib/ledger'
import { listSaved } from '@/lib/saved'
import { readSession } from '@/lib/session'
import { payConfig, settleReturn } from '@/lib/stripe'
import SavedView from './saved'

export const dynamic = 'force-dynamic'

export default async function SavedPage({ searchParams }: { searchParams: Promise<{ topup?: string; tab?: string }> }) {
  const session = await readSession()
  if (!session) redirect('/')
  const { topup, tab } = await searchParams
  await ensureAccount(session)
  const notice = await settleReturn(session.sub, topup)
  const [items, account] = await Promise.all([listSaved(session.sub), ensureAccount(session)])
  return (
    <SavedView
      items={items}
      wallet={walletOf(account)}
      currency={account.currency}
      email={session.email}
      pay={payConfig()}
      notice={notice}
      initialTab={tab === 'review' || tab === 'job' || tab === 'email' ? tab : null}
    />
  )
}
