'use client'

import { useMemo, useState } from 'react'
import Header from '../header'
import Recharge from '../recharge'
import type { SavedEmail, SavedItem, SavedJob, SavedNote } from '@/lib/saved'

type Tab = 'note' | 'email' | 'job'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'note', label: 'Emails written' },
  { id: 'email', label: 'Contacts found' },
  { id: 'job', label: 'Jobs found' },
]

function when(at: string): string {
  const d = new Date(at)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days === 0) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function SavedView({ items, balancePaise, email, upi }: { items: SavedItem[]; balancePaise: number; email: string; upi: { id: string; name: string } }) {
  const [tab, setTab] = useState<Tab>('note')
  const [recharge, setRecharge] = useState(false)
  const [q, setQ] = useState('')

  const groups = useMemo(() => {
    const notes = items.filter((i): i is SavedNote => i.kind === 'note')
    const emails = items.filter((i): i is SavedEmail => i.kind === 'email')
    const jobs = items.filter((i): i is SavedJob => i.kind === 'job')
    return { note: notes, email: emails, job: jobs }
  }, [items])

  const needle = q.trim().toLowerCase()
  const match = (hay: string) => !needle || hay.toLowerCase().includes(needle)

  return (
    <main className="wrap">
      <Header active="saved" email={email} balance={balancePaise} onRecharge={() => setRecharge(true)} />
      {recharge ? <Recharge need={0} balance={balancePaise} upi={upi} onClose={() => setRecharge(false)} /> : null}

      <h2 style={{ marginTop: 0 }}>Everything you have found</h2>
      <p className="small muted">Saved automatically. Nothing here costs anything to look at again.</p>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label} <span className="count">{groups[t.id].length}</span>
          </button>
        ))}
      </div>

      {items.length > 0 ? (
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by company, role or name" style={{ marginBottom: 14 }} />
      ) : null}

      {tab === 'note' ? (
        groups.note.filter((n) => match(`${n.subject} ${n.company} ${n.jobTitle} ${n.person ?? ''}`)).length === 0 ? (
          <Empty what="emails" />
        ) : (
          groups.note
            .filter((n) => match(`${n.subject} ${n.company} ${n.jobTitle} ${n.person ?? ''}`))
            .map((n, i) => <NoteCard key={`${n.at}-${i}`} n={n} />)
        )
      ) : null}

      {tab === 'email' ? (
        groups.email.filter((e) => match(`${e.name} ${e.company} ${e.title} ${e.emails.join(' ')}`)).length === 0 ? (
          <Empty what="contacts" />
        ) : (
          groups.email
            .filter((e) => match(`${e.name} ${e.company} ${e.title} ${e.emails.join(' ')}`))
            .map((e, i) => (
              <div className="card" key={`${e.linkedin_url}-${i}`}>
                <div className="row between">
                  <div>
                    <div><a href={e.linkedin_url} target="_blank" rel="noreferrer">{e.name || 'Unnamed'}</a>{e.company ? <span className="muted"> · {e.company}</span> : null}</div>
                    <div className="meta">{e.title}</div>
                    <div className="email">{e.emails.join(' · ') || 'no email'}</div>
                  </div>
                  <div className="row" style={{ flexShrink: 0 }}>
                    <span className="meta">{when(e.at)}</span>
                    {e.emails[0] ? <CopyBtn text={e.emails.join(', ')} label="copy" /> : null}
                  </div>
                </div>
              </div>
            ))
        )
      ) : null}

      {tab === 'job' ? (
        groups.job.filter((j) => match(`${j.title} ${j.company} ${j.location}`)).length === 0 ? (
          <Empty what="jobs" />
        ) : (
          groups.job
            .filter((j) => match(`${j.title} ${j.company} ${j.location}`))
            .map((j, i) => (
              <div className="card" key={`${j.id}-${i}`}>
                <div className="row between">
                  <div>
                    <div className="job-title"><a href={j.url} target="_blank" rel="noreferrer">{j.title}</a></div>
                    <div className="meta"><b>{j.company}</b>{j.location ? ` · ${j.location}` : ''}{j.remote ? ' · remote' : ''}{j.salary ? ` · ${j.salary}` : ''} · posted {j.posted}</div>
                  </div>
                  <span className="meta" style={{ flexShrink: 0 }}>{when(j.at)}</span>
                </div>
              </div>
            ))
        )
      ) : null}
    </main>
  )
}

function Empty({ what }: { what: string }) {
  return (
    <p className="muted">
      No {what} yet. <a href="/app">Start a search</a> and everything you find lands here.
    </p>
  )
}

function NoteCard({ n }: { n: SavedNote }) {
  const full = n.subject ? `Subject: ${n.subject}\n\n${n.body}` : n.body
  return (
    <div className="card">
      <div className="row between">
        <div>
          <div className="job-title">{n.subject || 'Untitled'}</div>
          <div className="meta">
            {n.person ? `To ${n.person} · ` : ''}{n.jobTitle} at <b>{n.company}</b>
            {n.to ? <> · <span className="email">{n.to}</span></> : null}
          </div>
        </div>
        <div className="row" style={{ flexShrink: 0 }}>
          <span className="meta">{when(n.at)}</span>
          <CopyBtn text={full} label="copy email" />
        </div>
      </div>
      <pre className="note">{n.body}</pre>
    </div>
  )
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn ghost sm"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
    >
      {done ? 'copied' : label}
    </button>
  )
}
