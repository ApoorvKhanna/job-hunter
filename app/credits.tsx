'use client'

import { useEffect, useRef, useState } from 'react'
import Recharge from './recharge'
import { type Currency, LEGACY_EMAIL_PRICE, PACKS, type PackId, type Wallet, money, packLabel } from '@/lib/prices'
import { track } from '@/lib/track'

export interface PayConfig { stripe: boolean; upi: { id: string; name: string } }

/** Why the sheet opened: out of emails, asked for a deep search, hit today's
 *  free limit, or (null) the header's Get emails. */
export type PayReason = 'email' | 'deep' | 'limit' | null

const HEAD: Record<'email' | 'deep' | 'limit' | 'none', { title: string; line: string }> = {
  email: { title: 'Get more emails', line: 'Searching and finding the people hiring stay free. You pay only for the emails you reveal.' },
  deep: { title: 'Deep search comes with every pack', line: 'When the free search comes back thin, a deep search looks through a second, larger job database.' },
  limit: { title: 'Raise your daily limit', line: 'Any pack lifts the free limits to 15 searches and 30 company lookups a day.' },
  none: { title: 'Get emails', line: 'Searching and finding the people hiring stay free. You pay only for the emails you reveal.' },
}

// The packs sheet. With Stripe set up: pick a pack, pay on Stripe's page (UPI
// or card for rupee accounts, card for dollar accounts), come back with it
// added. Without it, rupee accounts get the manual UPI QR, which adds money.
export default function Credits({
  currency,
  wallet,
  reason = null,
  pay,
  returnTo,
  onClose,
  onCredited,
}: {
  currency: Currency
  wallet: Wallet
  reason?: PayReason
  pay: PayConfig
  returnTo: 'app' | 'jobs' | 'review' | 'saved'
  onClose: () => void
  onCredited?: (balance: number) => void
}) {
  const [pick, setPick] = useState<PackId>('s')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const head = HEAD[reason ?? 'none']
  const manual = !pay.stripe && currency === 'inr' && !!pay.upi.id

  // Staging: bring the sheet to the eye and put focus on the choice. Esc
  // closes it, like every other sheet people use.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    sheet.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    sheet.current?.querySelector<HTMLButtonElement>('.chip.on')?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The one number the funnel turns on: how often this sheet opens, and why.
  useEffect(() => {
    track('paywall_shown', { reason: reason ?? 'header', from: returnTo, currency, emails: wallet.emails, deep: wallet.deep, balance: wallet.balance })
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (manual) {
    // Without Stripe there are no packs: a UPI top-up adds money, which buys
    // emails at the legacy price but never deep searches or a higher limit.
    return (
      <>
        {reason === 'deep' || reason === 'limit' ? (
          <div className="notice">Packs are not available right now. A UPI top-up adds money, which buys emails at {money(LEGACY_EMAIL_PRICE[currency], currency)} each.</div>
        ) : null}
        <Recharge need={0} balance={wallet.balance} upi={pay.upi} onClose={onClose} onCredited={onCredited} />
      </>
    )
  }

  // Whole rupees, or cents: "about ₹19 an email", "about $0.63 an email".
  const each = (price: number, emails: number) => (currency === 'inr' ? Math.round(price / emails / 100) * 100 : Math.round(price / emails))
  const chosen = PACKS.find((p) => p.id === pick) ?? PACKS[0]
  const cheapest = PACKS.reduce((a, b) => (b.price[currency] / b.emails < a.price[currency] / a.emails ? b : a))

  async function checkout() {
    setBusy(true)
    setMsg(null)
    track('checkout_opened', { pack: chosen.id, amount: chosen.price[currency], currency, reason: reason ?? 'header' })
    try {
      const res = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pack: chosen.id, return: returnTo }) })
      const j = (await res.json()) as { ok: boolean; message?: string; data?: { url: string } }
      if (j.ok && j.data?.url) {
        window.location.href = j.data.url
        return
      }
      setMsg(j.message ?? 'Could not open the payment page. Try again.')
    } catch {
      setMsg('Could not open the payment page. Try again.')
    }
    setBusy(false)
  }

  return (
    <div className="sheet" role="dialog" aria-label={head.title} ref={sheet}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>{head.title}</h2>
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      <p className="small muted">{head.line}</p>
      {!pay.stripe ? (
        <div className="notice">Payments are not switched on yet. Try again later.</div>
      ) : (
        <>
          <div className="packs" role="radiogroup" aria-label="Pack">
            {PACKS.map((p) => (
              <button key={p.id} role="radio" aria-checked={pick === p.id} className={`pack${pick === p.id ? ' on' : ''}`} onClick={() => setPick(p.id)}>
                <span className="pack-emails">{p.emails} emails</span>
                <span className="pack-deep">+ {p.deep} deep searches</span>
                <span className="pack-price">{money(p.price[currency], currency)}</span>
                <span className="pack-each">about {money(each(p.price[currency], p.emails), currency)} an email</span>
                {p.id === cheapest.id ? <span className="amount-tag">Lowest per email</span> : null}
              </button>
            ))}
          </div>
          <button className="btn" onClick={checkout} disabled={busy}>
            {busy ? <span className="spin" /> : null} Pay {money(chosen.price[currency], currency)} {currency === 'inr' ? 'by UPI or card' : 'by card'}
          </button>
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            {packLabel(chosen)}. Never expire. Secure checkout by Stripe; you come straight back here.
            {wallet.balance >= LEGACY_EMAIL_PRICE[currency] ? ` Your ${money(wallet.balance, currency)} from before still buys emails at ${money(LEGACY_EMAIL_PRICE[currency], currency)} each.` : ''}
          </p>
          {msg ? <div className="notice err">{msg}</div> : null}
        </>
      )}
    </div>
  )
}
