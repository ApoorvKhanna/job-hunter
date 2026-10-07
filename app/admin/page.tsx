'use client'

import { useEffect, useState } from 'react'
import { usd } from '@/lib/prices'

interface Person { sub: string; email: string; name: string; created_at: string; balance_cents: number; topped_up_cents: number; top_ups: number; spent_cents: number; runs: number; last_at: string | null }
interface Totals { accounts: number; top_ups: number; topped_up_cents: number; balance_cents: number; spent_cents: number; welcome_cents: number; paying_users: number }

export default function Admin() {
  const [token, setToken] = useState('')
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
    const r = await fetch('/api/admin/accounts', { headers: { 'x-admin-token': t } })
    if (!r.ok) return setMsg('wrong token')
    const j = (await r.json()) as { data: { totals: Totals; people: Person[] } }
    setTotals(j.data.totals)
    setPeople(j.data.people)
    setMsg('')
  }
  useEffect(() => {
    if (token) void load(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const shown = people.filter((p) => (filter === 'paid' ? p.topped_up_cents > 0 : filter === 'active' ? p.runs > 0 : true))
  const cell = { padding: '6px 8px' }
  const num = { ...cell, textAlign: 'right' as const }

  return (
    <main className="wrap">
      <nav className="nav"><span className="brand">Job Hunter <span>admin</span></span><span className="small muted">{totals ? `${totals.accounts} accounts` : ''}</span></nav>
      <div className="row"><input type="text" placeholder="admin token" value={token} onChange={(e) => setToken(e.target.value)} style={{ maxWidth: 320 }} /><button className="btn sm" onClick={() => load()}>load</button><span className="small muted">{msg}</span></div>
      {totals ? (
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', margin: '14px 0 6px' }}>
          <Stat label="Card top-ups" value={`${usd(totals.topped_up_cents)} · ${totals.top_ups}`} />
          <Stat label="Paying users" value={`${totals.paying_users} of ${totals.accounts}`} />
          <Stat label="Spent on runs" value={usd(totals.spent_cents)} />
          <Stat label="Balances outstanding" value={usd(totals.balance_cents)} />
          <Stat label="Welcome credit granted" value={usd(totals.welcome_cents)} />
        </div>
      ) : null}
      <p className="small muted">Refunds and disputes live in your Stripe dashboard. To block an account, POST /api/admin/block with this token</p>
      <h2>People</h2>
      <div className="chips" style={{ margin: '0 0 10px' }}>
        {(['all', 'paid', 'active'] as const).map((f) => (
          <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? `all (${people.length})` : f === 'paid' ? `paid (${people.filter((p) => p.topped_up_cents > 0).length})` : `ran a search (${people.filter((p) => p.runs > 0).length})`}
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={cell}>User</th>
              <th style={num}>Balance</th>
              <th style={num}>Topped up</th>
              <th style={num}>Spent</th>
              <th style={num}>Runs</th>
              <th style={cell}>Joined</th>
              <th style={cell}>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.sub} style={{ borderTop: '1px solid var(--line, #e6e3dc)' }}>
                <td style={cell}><div>{p.name}</div><div className="muted small">{p.email}</div></td>
                <td style={{ ...num, fontWeight: 600 }}>{usd(p.balance_cents)}</td>
                <td style={num}>{p.topped_up_cents ? `${usd(p.topped_up_cents)} (${p.top_ups})` : '-'}</td>
                <td style={num}>{usd(p.spent_cents)}</td>
                <td style={num}>{p.runs}</td>
                <td style={cell} className="muted">{new Date(p.created_at).toLocaleDateString('en-US')}</td>
                <td style={cell} className="muted">{p.last_at ? new Date(p.last_at).toLocaleString('en-US') : '-'}</td>
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
