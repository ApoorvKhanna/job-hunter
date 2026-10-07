import { redirect } from 'next/navigation'
import { ensureAccount } from '@/lib/ledger'
import { listSaved } from '@/lib/saved'
import { readSession } from '@/lib/session'
import { cardsEnabled } from '@/lib/stripe'
import SavedView from './saved'

export const dynamic = 'force-dynamic'

export default async function SavedPage() {
  const session = await readSession()
  if (!session) redirect('/')
  const [items, account] = await Promise.all([listSaved(session.sub), ensureAccount(session)])
  return <SavedView items={items} balanceCents={account.balanceCents} email={session.email} cardsEnabled={cardsEnabled()} />
}
