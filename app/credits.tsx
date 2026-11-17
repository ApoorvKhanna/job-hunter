'use client'

import { useState } from 'react'
import Recharge from './recharge'
import { type Currency, TOP_UPS, money } from '@/lib/prices'

export interface PayConfig { stripe: boolean; upi: { id: string; name: string } }

// The add-credits sheet. With Stripe set up: pick an amount, pay on Stripe's
// page (UPI or card for rupee accounts, card for dollar accounts), come back
// with the balance credited. Without it, rupee accounts get the manual UPI QR.
export default function Credits({
  currency,
  balance,
  need,
  pay,
  returnTo,
  onClose,
  onCredited,
}: {
  currency: Currency
  balance: number
  need: number
  pay: PayConfig
  returnTo: 'app' | 'jobs' | 'review' | 'saved'
  onClose: () => void
  onCredited?: (balance: number) => void
}) {
  const options = TOP_UPS[currency]
  const short = need > balance ? need - balance : 0
  const fit = options.find((v) => v * 100 >= short) ?? options[options.length - 1]
  const [amount, setAmount] = useState<number>(short ? fit : options[1] ?? options[0])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (!pay.stripe && currency === 'inr' && pay.upi.id) {
    return <Recharge need={need} balance={balance} upi={pay.upi} onClose={onClose} onCredited={onCredited} />
  }

  async function checkout() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount, return: returnTo }) })
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
    <div className="sheet" role="dialog" aria-label="Add credits">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Add credits</h2>
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      <p className="small muted">
        Balance {money(balance, currency)}.{short ? ` This step needs ${money(short, currency)} more.` : ''} Credits never expire.
      </p>
      {!pay.stripe ? (
        <div className="notice">Adding credits is not switched on yet. Try again later.</div>
      ) : (
        <>
          <div className="chips" style={{ margin: '12px 0' }}>
            {options.map((v) => (
              <button key={v} className={`chip${amount === v ? ' on' : ''}`} onClick={() => setAmount(v)}>{money(v * 100, currency)}</button>
            ))}
          </div>
          <button className="btn" onClick={checkout} disabled={busy}>
            {busy ? <span className="spin" /> : null} Pay {money(amount * 100, currency)} {currency === 'inr' ? 'by UPI or card' : 'by card'}
          </button>
          <p className="small muted" style={{ margin: '10px 0 0' }}>Secure checkout by Stripe. You come straight back here with the credits added.</p>
          {msg ? <div className="notice err">{msg}</div> : null}
        </>
      )}
    </div>
  )
}
