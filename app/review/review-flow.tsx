'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Credits, { type PayConfig } from '../credits'
import Header from '../header'
import Icon from '../icons'
import { type Links, linksFromResume, normalizeLinks } from '@/lib/links'
import type { PdfCapture } from '@/lib/pdf-client'
import { type Currency, money } from '@/lib/prices'

const STEPS = ['Resume', 'Profiles', 'Roles', 'Review'] as const
type StepIndex = 0 | 1 | 2 | 3

type Api<T> = { ok: true; data: T; balance?: number } | { ok: false; code: string; message: string; balance?: number; need?: number }

async function call<T>(path: string, body?: unknown): Promise<Api<T>> {
  try {
    const res = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (res.status === 401) {
      window.location.href = '/'
      return { ok: false, code: 'signed_out', message: 'Signed out.' }
    }
    return (await res.json()) as Api<T>
  } catch {
    return { ok: false, code: 'network', message: 'That did not go through. Check your connection and try again.' }
  }
}

const STAGE_LINES: Record<string, string[]> = {
  profiles: ['Reading your profiles…', 'Tracing where a recruiter’s eye lands…'],
  analysis: ['Tracing where a recruiter’s eye lands…', 'Matching you against each role…', 'Writing your fixes…'],
}

interface Past { id: string; at: string; roles: string[]; overall: number | null; headline: string }

export default function ReviewFlow({
  email,
  balance: startBalance,
  currency,
  price,
  pay,
  notice,
  past,
  lastLinks,
  resumeId,
}: {
  email: string
  balance: number
  currency: Currency
  price: number
  pay: PayConfig
  notice: string | null
  past: Past[]
  lastLinks: Links
  resumeId: string | null
}) {
  const [step, setStep] = useState<StepIndex>(resumeId ? 3 : 0)
  const [balance, setBalance] = useState(startBalance)
  const [error, setError] = useState<string | null>(null)
  const [credits, setCredits] = useState<{ need: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [fileName, setFileName] = useState('')
  const [capture, setCapture] = useState<PdfCapture | null>(null)
  const [links, setLinks] = useState<Record<keyof Links, string>>({
    linkedin: lastLinks.linkedin ?? '',
    x: lastLinks.x ?? '',
    github: lastLinks.github ?? '',
    site: lastLinks.site ?? '',
  })
  const [roles, setRoles] = useState<string[]>([''])
  const [suggested, setSuggested] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [run, setRun] = useState<{ id: string; status: string; stage: string | null; error: string | null } | null>(resumeId ? { id: resumeId, status: 'starting', stage: null, error: null } : null)
  const [tick, setTick] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const roleRefs = useRef<Array<HTMLInputElement | null>>([])
  const [over, setOver] = useState(false)

  // Postel: take roles however they arrive. A pasted "PM, Growth PM; Lead"
  // becomes three chips; Enter starts the next one.
  function setRole(i: number, value: string) {
    const parts = value.split(/[,;\n]+/)
    if (parts.length > 1) {
      const next = [...roles.slice(0, i), ...parts.map((x) => x.trim()).filter(Boolean), ...roles.slice(i + 1)].slice(0, 3)
      setRoles(next.length ? next : [''])
      return
    }
    setRoles(roles.map((x, j) => (j === i ? value : x)))
  }
  function onRoleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (roles[i].trim() && roles.length < 3 && i === roles.length - 1) {
      setRoles([...roles, ''])
      setTimeout(() => roleRefs.current[i + 1]?.focus(), 0)
    } else roleRefs.current[i + 1]?.focus()
  }
  const m = (n: number) => money(n, currency)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  // Waiting copy rotates so a two-minute wait does not look frozen.
  useEffect(() => {
    if (step !== 3) return
    const t = setInterval(() => setTick((n) => n + 1), 3500)
    return () => clearInterval(t)
  }, [step])

  const poll = useCallback(async (id: string) => {
    const started = Date.now()
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000))
      const r = await call<{ status: string; stage: string | null; error: string | null }>(`/api/review/${id}`)
      if (!r.ok) {
        if (Date.now() - started > 9 * 60_000) return
        continue
      }
      setRun({ id, ...r.data })
      if (r.data.status === 'done') {
        window.location.href = `/review/${id}`
        return
      }
      if (r.data.status === 'failed') {
        const b = await call<{ balance: number }>('/api/balance')
        if (b.ok) setBalance(b.data.balance)
        return
      }
      if (Date.now() - started > 9 * 60_000) return
    }
  }, [])

  const startRun = useCallback(
    async (id: string) => {
      setError(null)
      setStep(3)
      setRun({ id, status: 'starting', stage: null, error: null })
      const r = await call<{ status: string }>('/api/review/run', { id })
      if (r.balance != null) setBalance(r.balance)
      if (!r.ok) {
        setRun(null)
        if (r.code === 'recharge') {
          setStep(2)
          setCredits({ need: r.need ?? price })
        } else {
          setStep(2)
          setError(r.message)
        }
        return
      }
      setRun({ id, status: r.data.status, stage: 'profiles', error: null })
      await poll(id)
    },
    [poll, price],
  )

  // Back from paying for a review: start it.
  useEffect(() => {
    if (resumeId) void startRun(resumeId)
  }, [resumeId, startRun])

  async function upload(file: File) {
    setError(null)
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError('Upload your resume as a PDF. In Word or Google Docs: File, then Download or Save as PDF.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('That file is over 8 MB. Export a smaller PDF and try again.')
      return
    }
    setBusy('read')
    try {
      const { readPdf } = await import('@/lib/pdf-client')
      const cap = await readPdf(file)
      if (cap.text.replace(/\s+/g, ' ').trim().length < 200) {
        setError('We could not read text in that PDF. It may be a scan or an image. Export it again from your editor and upload that.')
        setBusy(null)
        return
      }
      setCapture(cap)
      setFileName(file.name)
      // Profile links printed on the resume fill any empty field.
      const found = linksFromResume(cap.links)
      setLinks((cur) => ({
        linkedin: cur.linkedin || found.linkedin || '',
        x: cur.x || (found.x ? `@${found.x}` : ''),
        github: cur.github || found.github || '',
        site: cur.site || found.site || '',
      }))
      try {
        localStorage.setItem('jh_resume', cap.text.slice(0, 20000))
      } catch {}
      // Suggest target roles from the resume (free).
      void call<{ titles: string[] }>('/api/parse', { resume: cap.text.slice(0, 12000) }).then((r) => {
        if (r.ok && r.data.titles?.length) {
          setSuggested(r.data.titles.slice(0, 5))
          setRoles((cur) => (cur.filter((x) => x.trim()).length ? cur : r.data.titles.slice(0, 2)))
        }
      })
    } catch (err) {
      console.error(err)
      setError('Could not open that PDF. Try exporting it again.')
    }
    setBusy(null)
  }

  async function start() {
    if (!capture) return
    setError(null)
    setBusy('start')
    const draft = await call<{ id: string }>('/api/review/start', {
      file_name: fileName,
      resume: capture.text,
      roles: roles.map((r) => r.trim()).filter(Boolean),
      notes,
      links,
      pages: capture.pages,
    })
    if (!draft.ok) {
      setBusy(null)
      setError(draft.message)
      return
    }
    const id = draft.data.id
    if (balance >= price) {
      setBusy(null)
      await startRun(id)
      return
    }
    if (!pay.stripe) {
      setBusy(null)
      setCredits({ need: price })
      return
    }
    const co = await call<{ url: string }>('/api/checkout', { review_id: id, return: 'review' })
    if (co.ok) {
      window.location.href = co.data.url
      return
    }
    setBusy(null)
    setError(co.message)
  }

  const clean = normalizeLinks(links)
  const given = (Object.keys(clean) as Array<keyof Links>).length
  const roleList = roles.map((r) => r.trim()).filter(Boolean)
  const short = Math.max(0, price - balance)

  return (
    <main className="wrap">
      <Header active="review" email={email} balance={balance} currency={currency} onRecharge={() => setCredits({ need: 0 })} />
      <ol className="status" aria-label="progress">
        {STEPS.map((label, i) => {
          const state = i < step ? 'done' : i === step ? 'current' : 'todo'
          return (
            <li key={label} className={state} onClick={() => i < step && step < 3 && setStep(i as StepIndex)}>
              <span className="dot">{i < step ? '✓' : i + 1}</span>
              <span className="label">{label}</span>
            </li>
          )
        })}
      </ol>
      {notice ? <div className="notice ok">{notice}</div> : null}
      {error ? <div className="notice err">{error}</div> : null}
      {credits ? (
        <Credits currency={currency} need={credits.need} balance={balance} pay={pay} returnTo="review" onClose={() => setCredits(null)} onCredited={setBalance} />
      ) : null}

      {step === 0 ? (
        <section>
          <h2 style={{ marginTop: 0 }}>Resume and profile review</h2>
          <p className="muted">
            See where a recruiter’s eye lands on your resume in the first six seconds and what it skips. Add your LinkedIn, X, GitHub or
            website and we check them against the roles you want. You get a score, the gaps, rewritten lines and a plan for the week.
          </p>
          {past.length > 0 ? (
            <div className="past">
              <span className="small muted">Your past reviews</span>
              {past.slice(0, 5).map((r) => (
                <a key={r.id} className="past-row" href={`/review/${r.id}`}>
                  <span className="past-score">{r.overall ?? '–'}</span>
                  <span>
                    <b>{r.roles.join(', ')}</b>
                    <span className="small muted"> · {new Date(r.at).toLocaleDateString(currency === 'inr' ? 'en-IN' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    {r.headline ? <span className="small muted past-head">{r.headline}</span> : null}
                  </span>
                  <span className="small">Open →</span>
                </a>
              ))}
            </div>
          ) : null}
          <div
            className={`drop big${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              if (!over) setOver(true)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) void upload(f)
            }}
          >
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            {capture ? (
              <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="thumb" src={capture.pages[0].image} alt="First page of your resume" />
                <div>
                  <b>{fileName}</b>
                  <p className="small muted" style={{ margin: '4px 0 10px' }}>
                    {capture.numPages} {capture.numPages === 1 ? 'page' : 'pages'}{capture.numPages > 2 ? ' (we scan the first two)' : ''} · {capture.text.split(/\s+/).length} words
                  </p>
                  <button className="btn ghost sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>Use a different file</button>
                </div>
              </div>
            ) : (
              <>
                <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
                  {busy === 'read' ? <span className="spin" /> : <Icon name="upload" size={15} weight={500} />} {busy === 'read' ? 'Reading your PDF…' : 'Upload your resume (PDF)'}
                </button>
                <span className="small muted">Or drag it here. It stays in your browser until you start the review.</span>
              </>
            )}
          </div>
          <div className="row">
            <button className="btn" onClick={() => setStep(1)} disabled={!capture || busy !== null}>Next: your profiles</button>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section>
          <h2 style={{ marginTop: 0 }}>Your profiles</h2>
          <p className="small muted">All optional. Add the ones you have; we read what is public and check it against your resume and target roles.</p>
          <div className="card fields">
            <Field label="LinkedIn" hint="linkedin.com/in/your-name" value={links.linkedin} ok={!!clean.linkedin} onChange={(v) => setLinks({ ...links, linkedin: v })} />
            <Field label="X (Twitter)" hint="@handle" value={links.x} ok={!!clean.x} onChange={(v) => setLinks({ ...links, x: v })} />
            <Field label="GitHub" hint="github.com/username" value={links.github} ok={!!clean.github} onChange={(v) => setLinks({ ...links, github: v })} />
            <Field label="Website or portfolio" hint="yourname.com" value={links.site} ok={!!clean.site} onChange={(v) => setLinks({ ...links, site: v })} />
          </div>
          <div className="row">
            <button className="btn" onClick={() => setStep(2)}>{given ? `Next: target roles (${given} ${given === 1 ? 'profile' : 'profiles'})` : 'Skip: review the resume only'}</button>
            <button className="btn ghost sm" onClick={() => setStep(0)}>Back</button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h2 style={{ marginTop: 0 }}>Roles you are targeting</h2>
          <p className="small muted">Up to three. We score your fit for each, list the gaps and the keywords recruiters search for.</p>
          <div className="card">
            <div className="chips" style={{ marginBottom: 10 }}>
              {roles.map((t, i) => (
                <span className="chip" key={i}>
                  <input ref={(el) => { roleRefs.current[i] = el }} value={t} placeholder="e.g. Product Manager" onChange={(e) => setRole(i, e.target.value)} onKeyDown={(e) => onRoleKey(i, e)} aria-label="target role" enterKeyHint="next" />
                  {roles.length > 1 ? <button onClick={() => setRoles(roles.filter((_, j) => j !== i))} aria-label="Remove role" title="Remove role">×</button> : null}
                </span>
              ))}
              {roles.length < 3 ? <button className="btn ghost sm" onClick={() => setRoles([...roles, ''])}>+ role</button> : null}
            </div>
            {suggested.filter((s) => !roles.includes(s)).length ? (
              <div className="row small" style={{ gap: 6 }}>
                <span className="muted">From your resume:</span>
                {suggested
                  .filter((s) => !roles.includes(s))
                  .map((s) => (
                    <button key={s} className="chip" disabled={roleList.length >= 3} onClick={() => setRoles([...roles.filter((x) => x.trim()), s].slice(0, 3))}>
                      + {s}
                    </button>
                  ))}
              </div>
            ) : null}
            <label className="small" style={{ display: 'block', marginTop: 14 }}>
              Anything we should know? <span className="muted">(optional)</span>
              <textarea className="short" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={600} placeholder="Switching from services to product, moving to Bangalore, back after a career break, aiming for remote roles…" />
            </label>
          </div>

          <div className="card pay-card">
            <div className="row between">
              <div>
                <b>Resume and profile review</b>
                <div className="small muted">Eye-tracking heatmap, {given ? `${given + 1} sources checked` : 'resume check'}, fit for {roleList.length || 1} {roleList.length === 1 ? 'role' : 'roles'}, rewrites and a 7-day plan. Saved to your account.</div>
              </div>
              <div className="pay-price">{m(price)}</div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={start} disabled={busy !== null || roleList.length === 0}>
                {busy === 'start' ? <span className="spin" /> : null}
                {short === 0 ? `Start review · ${m(price)}` : balance > 0 ? `Pay ${m(Math.max(short, currency === 'inr' ? 5000 : 100))} and start` : `Pay ${m(price)} and start`}
              </button>
              {short > 0 && balance > 0 ? <span className="small muted">Your {m(balance)} balance is used first.</span> : null}
              {short > 0 && pay.stripe ? <span className="small muted">{currency === 'inr' ? 'UPI or card' : 'Card'}, by Stripe.</span> : null}
            </div>
            <p className="small muted" style={{ margin: '10px 0 0' }}>If the review does not come through, the full amount goes back to your balance.</p>
          </div>
          <button className="btn ghost sm" onClick={() => setStep(1)}>Back</button>
        </section>
      ) : null}

      {step === 3 && run ? (
        <section className="waiting">
          {run.status === 'failed' ? (
            <>
              <h2 style={{ marginTop: 0 }}>That review did not finish</h2>
              <div className="notice err">{run.error ?? 'Something went wrong. Your money is back in your balance.'}</div>
              <div className="row">
                <button className="btn" onClick={() => startRun(run.id)}>Try again · {m(price)}</button>
                <a className="btn ghost sm" href="/review">Start over</a>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ marginTop: 0 }}>Reviewing your resume and profiles</h2>
              <p className="loading" role="status" style={{ margin: '8px 0 18px' }}>
                <span className="spin" /> {(STAGE_LINES[run.stage ?? 'profiles'] ?? STAGE_LINES.profiles)[tick % (STAGE_LINES[run.stage ?? 'profiles'] ?? STAGE_LINES.profiles).length]}
              </p>
              <p className="small muted">This takes a minute or two. You can leave this page: the review finishes on its own and is saved to your account.</p>
              <p className="small"><a href="/saved?tab=review">Saved reviews →</a></p>
            </>
          )}
        </section>
      ) : null}
    </main>
  )
}

function Field({ label, hint, value, ok, onChange }: { label: string; hint: string; value: string; ok: boolean; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input type="text" value={value} placeholder={hint} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoCapitalize="off" />
      <span className={`field-state${value.trim() ? (ok ? ' ok' : ' bad') : ''}`}>{value.trim() ? (ok ? '✓' : 'Check this') : ''}</span>
    </label>
  )
}
