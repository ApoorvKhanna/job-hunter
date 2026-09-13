import { redirect } from 'next/navigation'
import { UPI_ID, UPI_NAME } from '@/lib/env'
import { ensureAccount } from '@/lib/ledger'
import { listSaved } from '@/lib/saved'
import { readSession } from '@/lib/session'
import SavedView from './saved'

export const dynamic = 'force-dynamic'

export default async function SavedPage() {
  const session = await readSession()
  if (!session) redirect('/')
  const [items, account] = await Promise.all([listSaved(session.sub), ensureAccount(session)])
  return <SavedView items={items} balancePaise={account.balancePaise} email={session.email} upi={{ id: UPI_ID, name: UPI_NAME }} />
}
