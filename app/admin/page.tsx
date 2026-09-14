'use client'

import { useEffect, useState } from 'react'
import { inr } from '@/lib/prices'

interface Item { id: string; at: string; paise: number; utr: string; status: string; auto?: boolean }
interface Row { sub: string; email: string; name: string; balance_paise: number; wallet: string | null; pending: Item[]; recent: Item[] }

export default function Admin() {
  const [token, setToken] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [users, setUsers] = useState(0)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') ?? ''
    if (t) setToken(t)
  }, [])

  async function load(t = token) {
    setMsg('loading…')
    const r = await fetch('/api/admin/recharges', { headers: { 'x-admin-token': t } })
    if (!r.ok) return setMsg('wrong token')
    const j = (await r.json()) as { data: { users: number; rows: Row[] } }
    setRows(j.data.rows)
    setUsers(j.data.users)
    setMsg('')
  }
  useEffect(() => {
    if (token) void load(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function settle(sub: string, id: string, status: 'approved' | 'rejected' | 'reversed') {
    if (status === 'reversed' && !window.confirm('Take this credit back? The balance drops by the amount (never below zero).')) return
    const r = await fetch('/api/admin/recharges', { method: 'POST', headers: { 'x-admin-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ sub, id, status }) })
    if (!r.ok) return setMsg('failed')
    void load()
  }

  return (
    <main className="wrap">
      <nav className="nav"><span className="brand">Job Hunter <span>admin</span></span><span className="small muted">{users} accounts</span></nav>
      <div className="row"><input type="text" placeholder="admin token" value={token} onChange={(e) => setToken(e.target.value)} style={{ maxWidth: 320 }} /><button className="btn sm" onClick={() => load()}>load</button><span className="small muted">{msg}</span></div>
      <h2>Pending UPI recharges</h2>
      {rows && rows.every((r) => r.pending.length === 0) ? <p className="muted">None. Payments up to the daily cap are credited instantly and listed below for review.</p> : null}
      {rows?.map((r) =>
        r.pending.map((p) => (
          <div className="card" key={p.id}>
            <div className="row between">
              <div>
                <div><b>{inr(p.paise)}</b> from {r.name} <span className="muted small">{r.email}</span></div>
                <div className="meta">UTR <span className="email">{p.utr}</span> · {new Date(p.at).toLocaleString('en-IN')} · balance now {inr(r.balance_paise)}{r.wallet ? <> · wallet <span className="email">{r.wallet.slice(0, 14)}…</span></> : null}</div>
              </div>
              <div className="row">
                <button className="btn sm" onClick={() => settle(r.sub, p.id, 'approved')}>approve</button>
                <button className="btn ghost sm" onClick={() => settle(r.sub, p.id, 'rejected')}>reject</button>
              </div>
            </div>
          </div>
        )),
      )}
      <h2>Instant credits, last 7 days</h2>
      {rows && rows.every((r) => r.recent.length === 0) ? <p className="muted">None yet.</p> : null}
      {rows?.map((r) =>
        r.recent.map((p) => (
          <div className="card" key={p.id}>
            <div className="row between">
              <div>
                <div><b>{inr(p.paise)}</b> to {r.name} <span className="muted small">{r.email}</span></div>
                <div className="meta">UTR <span className="email">{p.utr}</span> · {new Date(p.at).toLocaleString('en-IN')} · balance now {inr(r.balance_paise)}</div>
              </div>
              <div className="row">
                <button className="btn ghost sm" onClick={() => settle(r.sub, p.id, 'reversed')}>reverse</button>
              </div>
            </div>
          </div>
        )),
      )}
    </main>
  )
}
