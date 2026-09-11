import { redirect } from 'next/navigation'
import { UPI_ID, UPI_NAME } from '@/lib/env'
import { ensureAccount } from '@/lib/ledger'
import { readSession } from '@/lib/session'
import Flow from './flow'

export const dynamic = 'force-dynamic'

export default async function AppPage() {
  const session = await readSession()
  if (!session) redirect('/')
  const account = await ensureAccount(session)
  return <Flow name={session.name} email={session.email} balancePaise={account.balancePaise} upi={{ id: UPI_ID, name: UPI_NAME }} />
}
