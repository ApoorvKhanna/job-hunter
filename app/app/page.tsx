import { redirect } from 'next/navigation'
import { ensureAccount } from '@/lib/ledger'
import { usd } from '@/lib/prices'
import { listSaved } from '@/lib/saved'
import { readSession } from '@/lib/session'
import { cardsEnabled, getCheckout, settleCheckout, topUpOwner } from '@/lib/stripe'
import Flow from './flow'

export const dynamic = 'force-dynamic'

export default async function AppPage({ searchParams }: { searchParams: Promise<{ topup?: string }> }) {
  const session = await readSession()
  if (!session) redirect('/')
  await ensureAccount(session)

  // Back from Stripe: credit the payment now rather than wait for the
  // webhook. Only the account that started the checkout can settle it.
  let notice: string | null = null
  const { topup } = await searchParams
  if (topup && cardsEnabled()) {
    const checkout = await getCheckout(topup)
    if (checkout && topUpOwner(checkout) === session.sub) {
      const settled = await settleCheckout(checkout).catch((err) => {
        console.error('[topup] return credit failed', err)
        return null
      })
      notice = settled ? `Added ${usd(settled.cents)} to your balance` : 'Your payment is still processing. Your balance updates when it clears'
    }
  }

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
  return <Flow email={session.email} balanceCents={account.balanceCents} cardsEnabled={cardsEnabled()} notice={notice} saved={saved} />
}
