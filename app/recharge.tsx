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
        <h2 style={{ margin: 0 }}>Recharge by UPI</h2>
        <button className="btn ghost sm" onClick={onClose}>close</button>
      </div>
      <p className="small muted">
        Balance {inr(balance)}.{need > balance ? ` This step needs ${inr(need)}.` : ''}
      </p>
      {!upi.id ? (
        <div className="notice">Recharges are not switched on yet. Try again later.</div>
      ) : state === 'sent' ? (
        <div className="notice" style={{ borderColor: 'var(--ok)' }}>Got it. Your {inr(amount * 100)} lands within an hour, usually faster. You can keep using the balance you have.</div>
      ) : (
        <>
          <div className="chips" style={{ margin: '8px 0 12px' }}>
            {RECHARGE_OPTIONS_INR.map((v) => (
              <button key={v} className={`chip${amount === v ? ' on' : ''}`} onClick={() => setAmount(v)}>₹{v}</button>
            ))}
          </div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
            {qr ? <img src={qr} alt="UPI QR" width={180} height={180} style={{ borderRadius: 8, background: '#fff' }} /> : null}
            <div className="small" style={{ flex: 1, minWidth: 200 }}>
              <p>Scan with any UPI app, or pay <span className="email">{upi.id}</span> for ₹{amount}.</p>
              <p><a className="btn ghost sm" href={link}>Open UPI app</a></p>
              <p style={{ marginTop: 12 }}>Then paste the UTR / transaction ID from the app:</p>
              <div className="row">
                <input type="text" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="12-digit UTR" style={{ maxWidth: 220 }} />
                <button className="btn sm" onClick={submit} disabled={utr.trim().length < 8}>I have paid</button>
              </div>
              {state === 'error' ? <p style={{ color: 'var(--err)' }}>{msg}</p> : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
