'use client'

import { useCallback, useEffect, useState } from 'react'
import { PRICES } from '@/lib/prices'
import type { Api, Job, Person, Profile } from '@/lib/types'

type Gate = { message: string; url?: string; code: string } | null

async function call<T>(path: string, body?: unknown): Promise<Api<T>> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 401) {
    window.location.href = '/'
    return { ok: false, code: 'signed_out', message: 'Signed out.' }
  }
  return (await res.json()) as Api<T>
}

function cents(n: number | null | undefined): string {
  if (n == null) return ''
  return n >= 100 ? `$${(n / 100).toFixed(2)}` : `${n}¢`
}

const SENIORITY = ['junior', 'mid_level', 'senior', 'staff', 'c_level'] as const

export default function Hunt({ email }: { email: string | null }) {
  const [balance, setBalance] = useState<number | null>(null)
  const [cardOnFile, setCardOnFile] = useState<boolean | null>(null)
  const [resume, setResume] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [gate, setGate] = useState<Gate>(null)
  const [days, setDays] = useState(14)

  const refreshBalance = useCallback(async () => {
    const r = await call<{ availableCents: number; cardOnFile: boolean }>('/api/me')
    if (r.ok) {
      setBalance(r.data.availableCents)
      setCardOnFile(r.data.cardOnFile)
    }
  }, [])
  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('jh_resume')
      if (saved) setResume(saved)
    } catch {}
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('jh_resume', resume)
    } catch {}
  }, [resume])

  function settle<T>(r: Api<T>): T | null {
    if (!r.ok) {
      setGate({ message: r.message, url: r.url, code: r.code })
      return null
    }
    setGate(null)
    if (r.balance_cents != null) setBalance(r.balance_cents)
    else void refreshBalance()
    return r.data
  }

  async function parse() {
    setBusy('parse')
    const data = settle(await call<Profile>('/api/parse', { resume }))
    if (data) {
      setProfile(data)
      setJobs(null)
    }
    setBusy(null)
  }

  async function findJobs() {
    if (!profile) return
    setBusy('jobs')
    const data = settle(
      await call<Job[]>('/api/jobs', {
        titles: profile.titles,
        country_code: profile.country_code,
        remote: profile.remote,
        seniority: profile.seniority,
        days,
      }),
    )
    if (data) setJobs(data)
    setBusy(null)
  }

  const editTitle = (i: number, v: string) =>
    setProfile((p) => (p ? { ...p, titles: p.titles.map((t, j) => (j === i ? v : t)) } : p))
  const removeTitle = (i: number) =>
    setProfile((p) => (p ? { ...p, titles: p.titles.filter((_, j) => j !== i) } : p))
  const addTitle = () => setProfile((p) => (p && p.titles.length < 5 ? { ...p, titles: [...p.titles, ''] } : p))

  return (
    <main className="wrap">
      <nav className="nav">
        <a className="brand" href="/">
          Job Hunt Agent <span>by Vaaya</span>
        </a>
        <div className="nav-right">
          {email ? <span className="small">{email}</span> : null}
          <span className="pill" title="Your Vaaya balance">
            {balance == null ? '…' : cents(balance)}
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="btn ghost sm" type="submit">
              sign out
            </button>
          </form>
        </div>
      </nav>

      {gate ? (
        <div className={`notice ${gate.code === 'card_required' || gate.code === 'credits_required' ? '' : 'err'}`}>
          {gate.message}{' '}
          {gate.url ? (
            <a href={gate.url} target="_blank" rel="noreferrer">
              Open Vaaya
            </a>
          ) : null}
        </div>
      ) : null}
      {cardOnFile === false && balance != null && balance < 60 ? (
        <div className="notice">
          Your balance is under 60¢. A round needs about 55¢.{' '}
          <a href="https://vaaya.ai/credits" target="_blank" rel="noreferrer">
            Add credit on Vaaya
          </a>
        </div>
      ) : null}

      <h2 style={{ marginTop: 0 }}>1. Your resume</h2>
      <textarea
        value={resume}
        onChange={(e) => setResume(e.target.value)}
        placeholder="Paste the plain text of your resume here. It stays in this browser."
        spellCheck={false}
      />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={parse} disabled={busy !== null || resume.trim().length < 80}>
          {busy === 'parse' ? <span className="spin" /> : null} Read my resume <span className="price">{PRICES.parse}</span>
        </button>
      </div>

      {profile ? (
        <>
          <h2>2. What to search for</h2>
          <div className="card">
            <p className="small muted" style={{ marginBottom: 8 }}>
              {profile.headline}
              {profile.years ? ` · ${profile.years} yrs` : ''}
            </p>
            <div className="chips" style={{ marginBottom: 10 }}>
              {profile.titles.map((t, i) => (
                <span className="chip" key={i}>
                  <input value={t} onChange={(e) => editTitle(i, e.target.value)} aria-label="job title" />
                  <button onClick={() => removeTitle(i)} aria-label="remove">
                    ×
                  </button>
                </span>
              ))}
              {profile.titles.length < 5 ? (
                <button className="btn ghost sm" onClick={addTitle}>
                  + title
                </button>
              ) : null}
            </div>
            <div className="row small">
              <label className="row" style={{ gap: 6 }}>
                Country
                <input
                  type="text"
                  value={profile.country_code}
                  onChange={(e) => setProfile({ ...profile, country_code: e.target.value.toUpperCase().slice(0, 2) })}
                  style={{ width: '5ch' }}
                  aria-label="country code"
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={profile.remote === true}
                  onChange={(e) => setProfile({ ...profile, remote: e.target.checked ? true : null })}
                />
                Remote only
              </label>
              <label className="row" style={{ gap: 6 }}>
                Level
                <select
                  value={profile.seniority ?? ''}
                  onChange={(e) =>
                    setProfile({ ...profile, seniority: (e.target.value || null) as Profile['seniority'] })
                  }
                >
                  <option value="">any</option>
                  {SENIORITY.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row" style={{ gap: 6 }}>
                Posted in last
                <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {[7, 14, 30].map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <button
            className="btn"
            onClick={findJobs}
            disabled={busy !== null || profile.titles.filter((t) => t.trim()).length === 0}
          >
            {busy === 'jobs' ? <span className="spin" /> : null} Find matching jobs{' '}
            <span className="price">{PRICES.jobs} for up to 10</span>
          </button>
        </>
      ) : null}

      {jobs ? (
        <>
          <h2>3. Postings</h2>
          {jobs.length === 0 ? (
            <p className="muted">Nothing posted for those titles in the window. Widen the titles or the dates and search again.</p>
          ) : null}
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} resume={resume} settle={settle} />
          ))}
        </>
      ) : null}

      <p className="footer">
        Every call is billed to your Vaaya account only when it succeeds. Prices are quoted by Vaaya per call.
      </p>
    </main>
  )
}

function JobCard({
  job,
  resume,
  settle,
}: {
  job: Job
  resume: string
  settle: <T>(r: Api<T>) => T | null
}) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [emails, setEmails] = useState<Record<string, { work: string[]; personal: string[] }>>({})
  const [note, setNote] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<Person | null>(null)
  const [open, setOpen] = useState(false)

  async function findPeople() {
    setBusy('people')
    const data = settle(await call<Person[]>('/api/contact', { company: job.company, job_title: job.title }))
    if (data) setPeople(data)
    setBusy(null)
  }
  async function reveal(p: Person) {
    setBusy(`email:${p.linkedin_url}`)
    const data = settle(await call<{ work: string[]; personal: string[] }>('/api/email', { linkedin_url: p.linkedin_url }))
    if (data) setEmails((m) => ({ ...m, [p.linkedin_url]: data }))
    setBusy(null)
  }
  async function draft(p: Person | null) {
    setBusy('draft')
    const data = settle(
      await call<string>('/api/draft', {
        resume,
        job: { title: job.title, company: job.company, description: job.description, url: job.url },
        person: p ? { name: p.name, title: p.title } : undefined,
      }),
    )
    if (data) {
      setNote(data)
      setNoteFor(p)
    }
    setBusy(null)
  }

  return (
    <div className="card">
      <div className="row between">
        <div>
          <div className="job-title">
            <a href={job.url} target="_blank" rel="noreferrer">
              {job.title}
            </a>
          </div>
          <div className="meta">
            <b>{job.company}</b>
            {job.location ? ` · ${job.location}` : ''}
            {job.remote ? ' · remote' : ''}
            {job.salary ? ` · ${job.salary}` : ''}
            {` · posted ${job.posted}`}
          </div>
        </div>
        <button className="btn ghost sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'hide' : 'details'}
        </button>
      </div>
      {open ? <pre className="note">{job.description.slice(0, 1500)}{job.description.length > 1500 ? '…' : ''}</pre> : null}

      {job.hiring_team.length > 0 && !people ? (
        <div className="small" style={{ marginTop: 8 }}>
          Listed on the posting:{' '}
          {job.hiring_team.map((h, i) => (
            <span key={i}>
              {h.linkedin_url ? (
                <a href={h.linkedin_url} target="_blank" rel="noreferrer">
                  {h.name}
                </a>
              ) : (
                h.name
              )}
              {h.title ? ` (${h.title})` : ''}
              {i < job.hiring_team.length - 1 ? ', ' : ''}
            </span>
          ))}
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 10 }}>
        {!people ? (
          <button className="btn sm" onClick={findPeople} disabled={busy !== null}>
            {busy === 'people' ? <span className="spin" /> : null} Find who is hiring{' '}
            <span className="price">{PRICES.contact}</span>
          </button>
        ) : null}
        <button className="btn ghost sm" onClick={() => draft(null)} disabled={busy !== null}>
          {busy === 'draft' && !noteFor ? <span className="spin" /> : null} Draft a note anyway{' '}
          <span className="price">{PRICES.draft}</span>
        </button>
      </div>

      {people ? (
        <div style={{ marginTop: 10 }}>
          {people.length === 0 ? <p className="small muted">No current managers or recruiters found for {job.company}.</p> : null}
          {people.map((p) => {
            const e = emails[p.linkedin_url]
            return (
              <div className="person" key={p.linkedin_url}>
                <div>
                  <div>
                    <a href={p.linkedin_url} target="_blank" rel="noreferrer">
                      {p.name}
                    </a>
                  </div>
                  <div className="meta">{p.title}</div>
                  {e ? (
                    <div className="email">
                      {[...e.work, ...e.personal].length ? [...e.work, ...e.personal].join(' · ') : 'no email on file'}
                    </div>
                  ) : null}
                </div>
                <div className="row" style={{ flexShrink: 0 }}>
                  {!e ? (
                    <button
                      className="btn ghost sm"
                      onClick={() => reveal(p)}
                      disabled={busy !== null || !(p.has_work_email || p.has_personal_email)}
                      title={p.has_work_email || p.has_personal_email ? '' : 'ContactOut has no email for this person'}
                    >
                      {busy === `email:${p.linkedin_url}` ? <span className="spin" /> : null} Email{' '}
                      <span className="price">{PRICES.email}</span>
                    </button>
                  ) : null}
                  <button className="btn sm" onClick={() => draft(p)} disabled={busy !== null}>
                    {busy === 'draft' && noteFor?.linkedin_url === p.linkedin_url ? <span className="spin" /> : null} Draft{' '}
                    <span className="price">{PRICES.draft}</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {note ? (
        <div style={{ marginTop: 10 }}>
          <div className="row between">
            <span className="small muted">Note{noteFor ? ` to ${noteFor.name}` : ''}</span>
            <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(note)}>
              copy
            </button>
          </div>
          <pre className="note">{note}</pre>
        </div>
      ) : null}
    </div>
  )
}
