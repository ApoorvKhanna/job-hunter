import { redirect } from 'next/navigation'
import { UPI_ID, UPI_NAME } from '@/lib/env'
import { ensureAccount } from '@/lib/ledger'
import { listSaved } from '@/lib/saved'
import { readSession } from '@/lib/session'
import Flow from './flow'

export const dynamic = 'force-dynamic'

export default async function AppPage() {
  const session = await readSession()
  if (!session) redirect('/')
  const [account, items] = await Promise.all([ensureAccount(session), listSaved(session.sub)])
  const notes = items.filter((i) => i.kind === 'note')
  const saved = {
    jobs: items.filter((i) => i.kind === 'job').length,
    contacts: items.filter((i) => i.kind === 'email').length,
    emails: notes.length,
    recent: notes.slice(0, 3).map((n) => ({
      subject: n.kind === 'note' ? n.subject : '',
      company: n.kind === 'note' ? n.company : '',
      person: n.kind === 'note' ? n.person : null,
    })),
  }
  return (
    <Flow
      name={session.name}
      email={session.email}
      balancePaise={account.balancePaise}
      upi={{ id: UPI_ID, name: UPI_NAME }}
      saved={saved}
    />
  )
}
