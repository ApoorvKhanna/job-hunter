import { redirect } from 'next/navigation'
import { getAlert, viewOf } from '@/lib/alerts'
import { ensureAccount, walletOf } from '@/lib/ledger'
import { listSaved } from '@/lib/saved'
import { readSession } from '@/lib/session'
import { payConfig, settleReturn } from '@/lib/stripe'
import Flow from './flow'

export const dynamic = 'force-dynamic'

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ topup?: string }> }) {
  const session = await readSession()
  if (!session) redirect('/')
  await ensureAccount(session)
  const notice = await settleReturn(session.sub, (await searchParams).topup)
  const [account, items, alert] = await Promise.all([
    ensureAccount(session),
    listSaved(session.sub),
    // The weekly email toggle; a read failure only hides its saved state.
    getAlert(session.sub).catch(() => null),
  ])
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
  return <Flow email={session.email} wallet={walletOf(account)} currency={account.currency} pay={payConfig()} saved={saved} notice={notice} alert={alert ? viewOf(alert) : null} />
}
