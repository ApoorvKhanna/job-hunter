'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Header from '../header'
import Recharge from '../recharge'
import { COUNTRIES, countryFlag } from '@/lib/countries'
import { plural, postedOn } from '@/lib/format'
import { PRICE_PAISE, inr } from '@/lib/prices'
import type { Job, Person, Profile } from '@/lib/types'
import { VARIANT_LABELS, type Variant } from '@/lib/variants'

type Api<T> = { ok: true; data: T; balance_paise: number; charged_paise?: number } | { ok: false; code: string; message: string; balance_paise?: number; need_paise?: number }

const STEPS = ['Resume', 'Profile', 'Jobs', 'Contacts', 'Email'] as const
type StepIndex = 0 | 1 | 2 | 3 | 4

async function post<T>(path: string, body: unknown): Promise<Api<T>> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (res.status === 401) {
      window.location.href = '/'
      return { ok: false, code: 'signed_out', message: 'Signed out.' }
    }
    return (await res.json()) as Api<T>
  } catch {
    return { ok: false, code: 'network', message: 'That step did not go through. Nothing was charged. Try again.' }
  }
}

export interface SavedSummary {
  jobs: number
  contacts: number
  emails: number
  recent: Array<{ subject: string; company: string; person: string | null }>
}

export default function Flow({
  name,
  email,
  balancePaise,
  upi,
  saved,
}: {
  name: string
  email: string
  balancePaise: number
  upi: { id: string; name: string }
  saved: SavedSummary
}) {
  const [step, setStep] = useState<StepIndex>(0)
  const [balance, setBalance] = useState(balancePaise)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recharge, setRecharge] = useState<{ need: number } | null>(null)

  const [resume, setResume] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [days, setDays] = useState(14)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [jobsPage, setJobsPage] = useState(0)
  const [moreJobs, setMoreJobs] = useState(true)
  const [job, setJob] = useState<Job | null>(null)
  const [people, setPeople] = useState<Person[] | null>(null)
  const [emails, setEmails] = useState<Record<string, { work: string[]; personal: string[] }>>({})
  const [person, setPerson] = useState<Person | null>(null)
  const [note, setNote] = useState<string | null>(null)

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
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  const settle = useCallback(<T,>(r: Api<T>): T | null => {
    if (r.balance_paise != null) setBalance(r.balance_paise)
    if (!r.ok) {
      if (r.code === 'recharge') setRecharge({ need: r.need_paise ?? 0 })
      else setError(r.message)
      return null
    }
    setError(null)
    return r.data
  }, [])

  // Step 0 → 1
  async function readResume() {
    setBusy('parse')
    const data = settle(await post<Profile>('/api/parse', { resume }))
    setBusy(null)
    if (data) {
      setProfile(data)
      setStep(1)
    }
  }
  // Step 1 → 2 (page 0) or append the next page
  async function findJobs(page = 0) {
    if (!profile) return
    setBusy(page === 0 ? 'jobs' : 'more')
    const data = settle(await post<Job[]>('/api/jobs', { titles: profile.titles.filter((t) => t.trim()), country_code: profile.country_code, remote: profile.remote, seniority: profile.seniority, days, page }))
    setBusy(null)
    if (data) {
      setJobs((prev) => (page === 0 || !prev ? data : [...prev, ...data.filter((j) => !prev.some((p) => p.id === j.id))]))
      setJobsPage(page)
      setMoreJobs(data.length >= 10)
      setStep(2)
    }
  }
  // Step 2 → 3
  async function pickJob(j: Job) {
    setJob(j)
    setPeople(null)
    setNote(null)
    setPerson(null)
    setBusy('people')
    const data = settle(await post<Person[]>('/api/contact', { company: j.company, company_domain: j.company_domain, job_title: j.title }))
    setBusy(null)
    if (data) {
      setPeople(data)
      setStep(3)
    }
  }
  async function reveal(p: Person) {
    setBusy(`email:${p.linkedin_url}`)
    const data = settle(await post<{ work: string[]; personal: string[] }>('/api/email', { linkedin_url: p.linkedin_url, name: p.name, title: p.title, company: job?.company }))
    setBusy(null)
    if (data) setEmails((m) => ({ ...m, [p.linkedin_url]: data }))
  }
  // Step 3 → 4
  const toOf = (p: Person | null) => {
    const e = p ? emails[p.linkedin_url] : undefined
    return e ? ([...e.work, ...e.personal][0] ?? null) : null
  }

  async function draft(p: Person | null) {
    if (!job) return
    setBusy(p ? `draft:${p.linkedin_url}` : 'draft')
    const data = settle(await post<string>('/api/draft', { resume, job: { title: job.title, company: job.company, description: job.description, url: job.url }, person: p ? { name: p.name, title: p.title } : undefined, to: toOf(p) }))
    setBusy(null)
    if (data) {
      setNote(data)
      setPerson(p)
      setStep(4)
    }
  }

  async function rewrite(variant: Variant) {
    if (!job || !note) return
    setBusy(`v:${variant}`)
    const data = settle(await post<string>('/api/draft', { resume, job: { title: job.title, company: job.company, description: job.description, url: job.url }, person: person ? { name: person.name, title: person.title } : undefined, to: toOf(person), variant, previous: note }))
    setBusy(null)
    if (data) setNote(data)
  }

  const loading = (() => {
    if (!busy) return null
    if (busy === 'parse') return 'Analysing your resume…'
    if (busy === 'jobs') return 'Finding jobs that match your search…'
    if (busy === 'more') return 'Finding more jobs…'
    if (busy === 'people') return `Finding contacts at ${job?.company ?? 'the company'}…`
    if (busy.startsWith('email:')) {
      const p = people?.find((x) => `email:${x.linkedin_url}` === busy)
      return p ? `Looking for ${p.name.split(' ')[0]}’s email…` : 'Looking for an email…'
    }
    return 'Drafting your email…'
  })()

  return (
    <main className="wrap">
      <Header active="search" email={email} balance={balance} onRecharge={() => setRecharge({ need: 0 })} />

      <StatusBar step={step} onJump={(i) => i < step && setStep(i)} />
      {loading ? <p className="loading" role="status"><span className="spin" /> {loading}</p> : null}

      {error ? <div className="notice err">{error}</div> : null}
      {recharge ? <Recharge need={recharge.need} balance={balance} upi={upi} onClose={() => setRecharge(null)} onCredited={setBalance} /> : null}

      {step === 0 && saved.jobs + saved.contacts + saved.emails > 0 ? (
        <a className="recap" href="/saved">
          <span className="recap-nums">
            <b>{saved.emails}</b> email {saved.emails === 1 ? 'draft' : 'drafts'}
            <i>·</i>
            <b>{saved.contacts}</b> {saved.contacts === 1 ? 'contact' : 'contacts'}
            <i>·</i>
            <b>{saved.jobs}</b> saved {saved.jobs === 1 ? 'job' : 'jobs'}
          </span>
          {saved.recent.length > 0 ? (
            <span className="recap-last">
              Latest draft: {saved.recent[0].subject || 'an email'}
              {saved.recent[0].person ? ` to ${saved.recent[0].person.split(' ')[0]}` : ''} at {saved.recent[0].company}
            </span>
          ) : null}
          <span className="recap-go">View saved results →</span>
        </a>
      ) : null}

      {step === 0 ? (
        <ResumeStep resume={resume} setResume={setResume} busy={busy} onNext={readResume} setError={setError} />
      ) : null}

      {step === 1 && profile ? (
        <section>
          <h2>Review your search</h2>
          <p className="small muted">We suggested these job titles from your resume. Edit or remove them, then choose where to search.</p>
          <div className="card">
            <p className="small muted" style={{ marginBottom: 8 }}>{profile.headline}{profile.years ? ` · ${profile.years} years of experience` : ''}</p>
            <div className="chips" style={{ marginBottom: 12 }}>
              {profile.titles.map((t, i) => (
                <span className="chip" key={i}>
                  <input value={t} onChange={(e) => setProfile({ ...profile, titles: profile.titles.map((x, j) => (j === i ? e.target.value : x)) })} aria-label="job title" />
                  <button onClick={() => setProfile({ ...profile, titles: profile.titles.filter((_, j) => j !== i) })} aria-label="Remove title" title="Remove title">×</button>
                </span>
              ))}
              {profile.titles.length < 5 ? <button className="btn ghost sm" onClick={() => setProfile({ ...profile, titles: [...profile.titles, ''] })}>+ title</button> : null}
            </div>
            <div className="row small">
              <label className="row" style={{ gap: 6 }}>
                Country
                <select value={COUNTRIES.some((c) => c.code === profile.country_code) ? profile.country_code : ''} onChange={(e) => setProfile({ ...profile, country_code: e.target.value })}>
                  <option value="">🌍 Any country</option>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
                </select>
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={profile.remote === true} onChange={(e) => setProfile({ ...profile, remote: e.target.checked ? true : null })} /> Remote roles only
              </label>
              <label className="row" style={{ gap: 6 }}>
                Date posted
                <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {[7, 14, 30].map((d) => <option key={d} value={d}>Last {d} days</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => findJobs(0)} disabled={busy !== null || profile.titles.filter((t) => t.trim()).length === 0}>
              {busy === 'jobs' ? <span className="spin" /> : null} Find matching jobs <span className="price">· {inr(PRICE_PAISE.jobs)}</span>
            </button>
            <button className="btn ghost" onClick={() => setStep(0)}>Back to resume</button>
          </div>
        </section>
      ) : null}

      {step === 2 && jobs ? (
        <section>
          <h2>{jobs.length ? `${plural(jobs.length, 'job')} found` : 'No jobs found'}</h2>
          {jobs.length ? <p className="small muted">Open a job title to read the posting, or find contacts at the company.</p> : null}
          {jobs.length === 0 ? (
            <p className="muted">No jobs matched those titles in that date range. <button className="btn ghost sm" onClick={() => setStep(1)}>Edit search preferences</button></p>
          ) : null}
          {jobs.map((j) => (
            <div className="card" key={j.id}>
              <div className="row between">
                <div>
                  <div className="job-title"><a href={j.url} target="_blank" rel="noreferrer">{j.title}</a></div>
                  <div className="meta"><b>{j.company}</b>{j.location ? ` · ${countryFlag(profile?.country_code ?? '')} ${j.location}` : ''}{j.remote ? ' · remote' : ''}{j.salary ? ` · ${j.salary}` : ''} · Posted {postedOn(j.posted)}</div>
                  {j.hiring_team.length ? <div className="small muted">On the posting: {j.hiring_team.map((h) => h.name).join(', ')}</div> : null}
                </div>
                <button className="btn sm" onClick={() => pickJob(j)} disabled={busy !== null}>
                  {busy === 'people' && job?.id === j.id ? <span className="spin" /> : null} Find contacts <span className="price">· {inr(PRICE_PAISE.contact)}</span>
                </button>
              </div>
            </div>
          ))}
          <div className="row">
            {jobs.length > 0 && moreJobs ? (
              <button className="btn" onClick={() => findJobs(jobsPage + 1)} disabled={busy !== null}>
                {busy === 'more' ? <span className="spin" /> : null} Find more jobs <span className="price">· {inr(PRICE_PAISE.jobs)}</span>
              </button>
            ) : null}
            <button className="btn ghost sm" onClick={() => setStep(1)}>Edit search preferences</button>
          </div>
        </section>
      ) : null}

      {step === 3 && job && people ? (
        <section>
          <h2>Contacts at {job.company}</h2>
          <p className="small muted">For <a href={job.url} target="_blank" rel="noreferrer">{job.title}</a>. Choose a contact to look up their email or draft a message.</p>
          {people.length === 0 ? <p className="muted">No managers or recruiters found at this company. You can still draft an email without a contact.</p> : null}
          <div className="card">
            {people.map((p) => {
              const e = emails[p.linkedin_url]
              const canReveal = p.has_work_email || p.has_personal_email
              return (
                <div className="person" key={p.linkedin_url}>
                  <div>
                    <div><a href={p.linkedin_url} target="_blank" rel="noreferrer">{p.name}</a></div>
                    <div className="meta">{p.title}</div>
                    {e ? <div className="email">{[...e.work, ...e.personal].join(' · ')}</div> : null}
                  </div>
                  <div className="row" style={{ flexShrink: 0 }}>
                    {p.linkedin_url ? <a className="btn ghost sm" href={p.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a> : null}
                    {!e ? (
                      <button className="btn ghost sm" onClick={() => reveal(p)} disabled={busy !== null || !canReveal} title={canReveal ? '' : 'No email on file'}>
                        {busy === `email:${p.linkedin_url}` ? <span className="spin" /> : null} Find email <span className="price">· {inr(PRICE_PAISE.email)}</span>
                      </button>
                    ) : null}
                    <button className="btn sm" onClick={() => draft(p)} disabled={busy !== null}>
                      {busy === `draft:${p.linkedin_url}` ? <span className="spin" /> : null} Draft email <span className="price">· {inr(PRICE_PAISE.draft)}</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="row">
            <button className="btn ghost" onClick={() => draft(null)} disabled={busy !== null}>Draft without a contact <span className="price">· {inr(PRICE_PAISE.draft)}</span></button>
            <button className="btn ghost sm" onClick={() => setStep(2)}>Back to jobs</button>
          </div>
        </section>
      ) : null}

      {step === 4 && job && note ? (
        <section>
          <h2>Your email draft{person ? ` for ${person.name.split(' ')[0]}` : ''}</h2>
          <p className="small muted">About: {job.title} at {job.company}{person && emails[person.linkedin_url] ? <> · To: <span className="email">{[...emails[person.linkedin_url].work, ...emails[person.linkedin_url].personal][0]}</span></> : null}{person?.linkedin_url ? <> · <a href={person.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a></> : null}</p>
          <p className="small muted">Review the details and personalise the draft before sending.</p>
          <pre className="note">{note}</pre>
          <div className="row">
            <CopyDraft text={note} />
            {person && emails[person.linkedin_url]?.work[0] ? (
              <a className="btn ghost" href={`mailto:${emails[person.linkedin_url].work[0]}?subject=${encodeURIComponent(note.split('\n')[0].replace(/^Subject:\s*/i, ''))}&body=${encodeURIComponent(note.split('\n').slice(2).join('\n'))}`}>Open in mail</a>
            ) : null}
            <button className="btn ghost sm" onClick={() => setStep(3)}>Choose another contact</button>
            <button className="btn ghost sm" onClick={() => setStep(2)}>Choose another job</button>
          </div>
          <div className="variants">
            <span className="small muted">Refine your draft</span>
            {VARIANT_LABELS.map((v) => (
              <button key={v.id} className="btn ghost sm" onClick={() => rewrite(v.id)} disabled={busy !== null}>
                {busy === `v:${v.id}` ? <span className="spin" /> : null} {v.label} <span className="price">· {inr(PRICE_PAISE.draft)}</span>
              </button>
            ))}
          </div>
          <p className="small muted">Saved automatically. <a href="/saved">View saved drafts →</a></p>
        </section>
      ) : null}

      <p className="footer">You’re charged only when a step succeeds.</p>
    </main>
  )
}

function StatusBar({ step, onJump }: { step: StepIndex; onJump: (i: StepIndex) => void }) {
  return (
    <ol className="status" aria-label="progress">
      {STEPS.map((label, i) => {
        const state = i < step ? 'done' : i === step ? 'current' : 'todo'
        return (
          <li key={label} className={state} onClick={() => onJump(i as StepIndex)}>
            <span className="dot">{i < step ? '✓' : i + 1}</span>
            <span className="label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function ResumeStep({ resume, setResume, busy, onNext, setError }: { resume: string; setResume: (s: string) => void; busy: string | null; onNext: () => void; setError: (s: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  async function upload(file: File) {
    setUploading(true)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/extract', { method: 'POST', body: fd })
    const j = (await res.json()) as { ok: boolean; data?: { text: string }; message?: string }
    setUploading(false)
    if (j.ok && j.data) {
      setResume(j.data.text)
      setFileName(file.name)
    } else setError(j.message ?? 'Could not read that file.')
  }

  return (
    <section>
      <h2>Add your resume</h2>
      <p className="small muted">We’ll use your experience to suggest job titles for your search.</p>
      <div
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files?.[0]
          if (f) void upload(f)
        }}
      >
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,application/pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <span className="spin" /> : null} Upload PDF or DOCX
        </button>
        <span className="small muted">{fileName ? `Loaded ${fileName}` : 'Drag and drop a file here, or paste your resume below.'}</span>
      </div>
      <textarea value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Paste your resume text here" spellCheck={false} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={onNext} disabled={busy !== null || uploading || resume.trim().length < 80}>
          {busy === 'parse' ? <span className="spin" /> : null} Analyse resume <span className="price">· {inr(PRICE_PAISE.parse)}</span>
        </button>
        <span className="small muted">{resume.trim().length < 80 ? 'Add your resume to continue.' : `${resume.trim().split(/\s+/).length} words`}</span>
      </div>
    </section>
  )
}


function CopyDraft({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
    >
      {done ? 'Draft copied' : 'Copy draft'}
    </button>
  )
}
