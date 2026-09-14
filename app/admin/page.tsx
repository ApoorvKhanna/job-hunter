'use client'

import { useEffect, useState } from 'react'
import { inr } from '@/lib/prices'

interface Item { id: string; at: string; paise: number; utr: string; status: string; auto?: boolean }
interface Row { sub: string; email: string; name: string; balance_paise: number; wallet: string | null; pending: Item[]; recent: Item[] }
interface Person { sub: string; email: string; name: string; created_at: string; balance_paise: number; recharged_paise: number; recharges: number; spent_paise: number; steps: number; last_at: string | null }
interface Totals { accounts: number; recharges: number; recharged_paise: number; balance_paise: number; spent_paise: number; welcome_paise: number; paying_users: number }

export default function Admin() {
  const [token, setToken] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [users, setUsers] = useState(0)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [filter, setFilter] = useState<'all' | 'paid' | 'active'>('all')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') ?? ''
    if (t) setToken(t)
  }, [])

  async function load(t = token) {
    setMsg('loading…')
    const r = await fetch('/api/admin/recharges', { headers: { 'x-admin-token': t } })
    if (!r.ok) return setMsg('wrong token')
    const j = (await r.json()) as { data: { users: number; rows: Row[]; totals: Totals; people: Person[] } }
    setRows(j.data.rows)
    setUsers(j.data.users)
    setTotals(j.data.totals)
    setPeople(j.data.people)
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
      {totals ? (
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', margin: '14px 0 6px' }}>
          <Stat label="UPI recharges" value={`${inr(totals.recharged_paise)} · ${totals.recharges}`} />
          <Stat label="Paying users" value={`${totals.paying_users} of ${totals.accounts}`} />
          <Stat label="Spent on steps" value={inr(totals.spent_paise)} />
          <Stat label="Balances outstanding" value={inr(totals.balance_paise)} />
          <Stat label="Welcome credit granted" value={inr(totals.welcome_paise)} />
        </div>
      ) : null}
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
      <h2>People</h2>
      <div className="chips" style={{ margin: '0 0 10px' }}>
        {(['all', 'paid', 'active'] as const).map((f) => (
          <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? `all (${people.length})` : f === 'paid' ? `paid (${people.filter((p) => p.recharged_paise > 0).length})` : `used a step (${people.filter((p) => p.steps > 0).length})`}</button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>User</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Balance</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Recharged</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Spent</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Steps</th>
              <th style={{ padding: '6px 8px' }}>Joined</th>
              <th style={{ padding: '6px 8px' }}>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {people
              .filter((p) => (filter === 'paid' ? p.recharged_paise > 0 : filter === 'active' ? p.steps > 0 : true))
              .map((p) => (
                <tr key={p.sub} style={{ borderTop: '1px solid var(--line, #e6e3dc)' }}>
                  <td style={{ padding: '6px 8px' }}><div>{p.name}</div><div className="muted small">{p.email}</div></td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{inr(p.balance_paise)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{p.recharged_paise ? `${inr(p.recharged_paise)} (${p.recharges})` : '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{inr(p.spent_paise)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{p.steps}</td>
                  <td style={{ padding: '6px 8px' }} className="muted">{new Date(p.created_at).toLocaleDateString('en-IN')}</td>
                  <td style={{ padding: '6px 8px' }} className="muted">{p.last_at ? new Date(p.last_at).toLocaleString('en-IN') : '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: '10px 14px', minWidth: 150 }}>
      <div className="small muted">{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  )
}
