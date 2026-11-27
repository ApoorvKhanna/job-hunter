'use client'

import { useEffect, useState } from 'react'
import { type Currency, inr, money } from '@/lib/prices'

interface Item { id: string; at: string; paise: number; utr: string; status: string; auto?: boolean }
interface Row { sub: string; email: string; name: string; currency: Currency; balance: number; wallet: string | null; pending: Item[]; recent: Item[] }
interface Person { sub: string; email: string; name: string; currency: Currency; created_at: string; balance: number; paid: number; payments: number; spent: number; steps: number; reviews: number; last_at: string | null }
interface Totals { accounts: number; payments: number; paid: number; balance: number; spent: number; welcome: number; paying_users: number; reviews: number }

export default function Admin() {
  const [token, setToken] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [users, setUsers] = useState(0)
  const [totals, setTotals] = useState<Record<Currency, Totals> | null>(null)
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
    const j = (await r.json()) as { data: { users: number; rows: Row[]; totals: Record<Currency, Totals>; people: Person[] } }
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
      {totals
        ? (['inr', 'usd'] as const).map((c) => (
            <div key={c} className="row" style={{ gap: 18, flexWrap: 'wrap', margin: '14px 0 6px' }}>
              <Stat label={`${c.toUpperCase()} paid in`} value={`${money(totals[c].paid, c)} · ${totals[c].payments}`} />
              <Stat label="Paying users" value={`${totals[c].paying_users} of ${totals[c].accounts}`} />
              <Stat label="Spent (net of refunds)" value={money(totals[c].spent, c)} />
              <Stat label="Reviews" value={String(totals[c].reviews)} />
              <Stat label="Balances outstanding" value={money(totals[c].balance, c)} />
              <Stat label="Welcome credit granted" value={money(totals[c].welcome, c)} />
            </div>
          ))
        : null}
      {token ? <WinBack token={token} /> : null}
      <h2>Pending UPI recharges</h2>
      {rows && rows.every((r) => r.pending.length === 0) ? <p className="muted">None. Payments up to the daily cap are credited instantly and listed below for review.</p> : null}
      {rows?.map((r) =>
        r.pending.map((p) => (
          <div className="card" key={p.id}>
            <div className="row between">
              <div>
                <div><b>{inr(p.paise)}</b> from {r.name} <span className="muted small">{r.email}</span></div>
                <div className="meta">UTR <span className="email">{p.utr}</span> · {new Date(p.at).toLocaleString('en-IN')} · balance now {money(r.balance, r.currency)}{r.wallet ? <> · wallet <span className="email">{r.wallet.slice(0, 14)}…</span></> : null}</div>
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
                <div className="meta">UTR <span className="email">{p.utr}</span> · {new Date(p.at).toLocaleString('en-IN')} · balance now {money(r.balance, r.currency)}</div>
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
          <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? `all (${people.length})` : f === 'paid' ? `paid (${people.filter((p) => p.paid > 0).length})` : `used a step (${people.filter((p) => p.steps > 0).length})`}</button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>User</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Balance</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Paid in</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Spent</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Steps</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Reviews</th>
              <th style={{ padding: '6px 8px' }}>Joined</th>
              <th style={{ padding: '6px 8px' }}>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {people
              .filter((p) => (filter === 'paid' ? p.paid > 0 : filter === 'active' ? p.steps > 0 : true))
              .map((p) => (
                <tr key={p.sub} style={{ borderTop: '1px solid var(--line, #e6e3dc)' }}>
                  <td style={{ padding: '6px 8px' }}><div>{p.name}</div><div className="muted small">{p.email}</div></td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{money(p.balance, p.currency)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{p.paid ? `${money(p.paid, p.currency)} (${p.payments})` : '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(p.spent, p.currency)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{p.steps}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{p.reviews || '—'}</td>
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

interface WinBackPreview {
  count: number
  sample: { subject: string; text: string } | null
  recipients: Array<{ email: string; name: string; createdAt: string; line: string }>
}

// The one-time note to launch-day sign-ups (lib/winback.ts). Preview first:
// the list and the exact text. Sending asks once more, and nobody gets it twice.
function WinBack({ token }: { token: string }) {
  const [preview, setPreview] = useState<WinBackPreview | null>(null)
  const [state, setState] = useState('')
  async function look() {
    setState('loading…')
    const r = await fetch('/api/admin/winback', { headers: { 'x-admin-token': token } })
    if (!r.ok) return setState('could not load')
    setPreview(((await r.json()) as { data: WinBackPreview }).data)
    setState('')
  }
  async function send() {
    if (!preview || !window.confirm(`Send the note to ${preview.count} people? Each person gets it once.`)) return
    setState('sending…')
    const r = await fetch('/api/admin/winback', { method: 'POST', headers: { 'x-admin-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ send: true }) })
    const j = (await r.json().catch(() => null)) as { data?: { sent: number; failed: number; skipped: number } } | null
    setState(j?.data ? `sent ${j.data.sent}, failed ${j.data.failed}, already had it ${j.data.skipped}` : 'send failed')
    void look()
  }
  return (
    <section className="card" style={{ margin: '18px 0' }}>
      <div className="row between">
        <b>Launch-day win-back note</b>
        <span className="row">
          <button className="btn ghost sm" onClick={look}>Preview</button>
          {preview && preview.count > 0 ? <button className="btn sm" onClick={send}>Send to {preview.count} people</button> : null}
        </span>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>Signed up 26 Nov to 27 Nov 12:10 IST, never paid, not blocked, not sent before. {state}</p>
      {preview ? (
        <>
          {preview.sample ? (
            <>
              <p className="small" style={{ margin: '12px 0 4px' }}><b>Subject:</b> {preview.sample.subject}</p>
              <pre className="note" style={{ whiteSpace: 'pre-wrap' }}>{preview.sample.text}</pre>
              <p className="small muted">The balance line changes per person (shown below).</p>
            </>
          ) : <p className="muted">Nobody left to send to.</p>}
          <ul className="small" style={{ maxHeight: 260, overflow: 'auto', paddingLeft: 18 }}>
            {preview.recipients.map((r) => (
              <li key={r.email}>{r.name} <span className="muted">{r.email} · {new Date(r.createdAt).toLocaleString('en-IN')} · {r.line}</span></li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
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
