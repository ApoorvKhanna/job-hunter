'use client'

import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { RECHARGE_OPTIONS_INR, inr } from '@/lib/prices'

export default function Recharge({ need, balance, upi, onClose }: { need: number; balance: number; upi: { id: string; name: string }; onClose: () => void }) {
  const [amount, setAmount] = useState<number>(RECHARGE_OPTIONS_INR[0])
  const [qr, setQr] = useState<string>('')
  const [utr, setUtr] = useState('')
  const [state, setState] = useState<'pay' | 'sent' | 'error'>('pay')
  const [msg, setMsg] = useState('')
  const link = `upi://pay?pa=${encodeURIComponent(upi.id)}&pn=${encodeURIComponent(upi.name)}&am=${amount}&cu=INR&tn=${encodeURIComponent('Job Hunter recharge')}`

  useEffect(() => {
    if (!upi.id) return
    QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(''))
  }, [link, upi.id])

  async function submit() {
    const res = await fetch('/api/recharge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inr: amount, utr }) })
    const j = (await res.json()) as { ok: boolean; message?: string }
    if (j.ok) setState('sent')
    else {
      setState('error')
      setMsg(j.message ?? 'Could not record that.')
    }
  }

  return (
    <div className="sheet" role="dialog" aria-label="Recharge">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Add credits with UPI</h2>
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      <p className="small muted">
        Current balance: {inr(balance)}.{need > balance ? ` This step needs ${inr(need)}.` : ''}
      </p>
      {!upi.id ? (
        <div className="notice">Adding credits is not switched on yet. Try again later.</div>
      ) : state === 'sent' ? (
        <div className="notice" style={{ borderColor: 'var(--ok)' }}>Thanks. We’ll add {inr(amount * 100)} to your balance once the payment is confirmed. You can keep using your current balance in the meantime.</div>
      ) : (
        <>
          <p className="small" style={{ margin: '8px 0 6px', fontWeight: 500 }}>Choose an amount</p>
          <div className="chips" style={{ margin: '0 0 12px' }}>
            {RECHARGE_OPTIONS_INR.map((v) => (
              <button key={v} className={`chip${amount === v ? ' on' : ''}`} onClick={() => setAmount(v)}>₹{v}</button>
            ))}
          </div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
            {qr ? <img src={qr} alt="UPI QR" width={180} height={180} style={{ borderRadius: 8, background: '#fff' }} /> : null}
            <div className="small" style={{ flex: 1, minWidth: 200 }}>
              <p>Scan the QR code with your UPI app to pay ₹{amount}. Or send ₹{amount} to <span className="email">{upi.id}</span>.</p>
              <p><a className="btn ghost sm" href={link}>Open your UPI app</a></p>
              <p style={{ marginTop: 12, marginBottom: 2, fontWeight: 500 }}>After paying, enter your payment reference</p>
              <p className="muted" style={{ marginBottom: 8 }}>Find the 12-digit UTR in your UPI payment details.</p>
              <div className="row">
                <input type="text" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="Enter your 12-digit UTR" style={{ maxWidth: 220 }} />
                <button className="btn sm" onClick={submit} disabled={utr.trim().length < 8}>Submit payment reference</button>
              </div>
              {state === 'error' ? <p style={{ color: 'var(--err)' }}>{msg}</p> : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
