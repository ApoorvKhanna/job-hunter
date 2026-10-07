'use client'

import { useState } from 'react'
import { RUN_CENTS, TOP_UP_USD, usd } from '@/lib/prices'

// The add-funds sheet: pick an amount, pay on Stripe's hosted page, come back
// to /app with the balance already credited.
export default function AddFunds({ need, balance, cardsEnabled, onClose }: { need: number; balance: number; cardsEnabled: boolean; onClose: () => void }) {
  const [amount, setAmount] = useState<number>(TOP_UP_USD[1])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const short = need > balance ? need - balance : 0

  async function pay() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usd: amount }) })
      const j = (await res.json()) as { ok: boolean; message?: string; data?: { url: string } }
      if (j.ok && j.data?.url) {
        window.location.href = j.data.url
        return
      }
      setMsg(j.message ?? 'Could not open the payment page. Try again')
    } catch {
      setMsg('Could not open the payment page. Try again')
    }
    setBusy(false)
  }

  return (
    <div className="sheet" role="dialog" aria-label="Add funds">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Add funds</h2>
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      <p className="small muted">
        Balance {usd(balance)}{short ? `. You need ${usd(short)} more to start a search` : ''}
      </p>
      <p className="small muted">A search costs {usd(RUN_CENTS)} and is charged only when it finds jobs</p>
      {!cardsEnabled ? (
        <div className="notice">Card payments are not set up on this server yet</div>
      ) : (
        <>
          <div className="chips" style={{ margin: '12px 0' }}>
            {TOP_UP_USD.map((v) => (
              <button key={v} className={`chip${amount === v ? ' on' : ''}`} onClick={() => setAmount(v)}>${v}</button>
            ))}
          </div>
          <button className="btn" onClick={pay} disabled={busy}>
            {busy ? <span className="spin" /> : null} Pay ${amount} by card
          </button>
          {msg ? <div className="notice err">{msg}</div> : null}
        </>
      )}
    </div>
  )
}
