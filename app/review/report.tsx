'use client'

import { useMemo, useState } from 'react'
import Credits, { type PayConfig } from '../credits'
import Header from '../header'
import Heatmap, { type HeatMode } from './heatmap'
import type { Block } from '@/lib/layout'
import type { Links, SourceKey } from '@/lib/links'
import { type Currency, money } from '@/lib/prices'
import type { Review } from '@/lib/review-store'

interface ReportReview {
  id: string
  at: string
  fileName: string
  roles: string[]
  links: Links
  pages: Array<{ n: number; width: number; height: number; image: boolean; blocks: Block[] }>
  result: NonNullable<Review['result']>
}

const SOURCE_NAME: Record<'resume' | SourceKey, string> = { resume: 'Resume', linkedin: 'LinkedIn', x: 'X', github: 'GitHub', site: 'Website' }

function tone(score: number | null): string {
  if (score == null) return ''
  return score >= 75 ? ' good' : score >= 50 ? ' fair' : ' weak'
}

function Score({ value, label }: { value: number | null; label?: string }) {
  return (
    <span className={`score${tone(value)}`} title={label}>
      {value ?? '–'}
      <small>/100</small>
    </span>
  )
}

function Bar({ value }: { value: number | null }) {
  return (
    <span className={`bar${tone(value)}`} aria-hidden="true">
      <span style={{ width: `${value ?? 0}%` }} />
    </span>
  )
}

/** Rewrites leave [placeholders] where only the candidate knows the number. */
function Fill({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]{1,60}\])/g).map((part, i) =>
        /^\[.*\]$/.test(part) ? <mark key={i} className="ph" title="Fill in your real number">{part}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  )
}

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
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
      {done ? 'Copied' : label}
    </button>
  )
}

export default function Report({ email, balance: startBalance, currency, price, pay, review }: { email: string; balance: number; currency: Currency; price: number; pay: PayConfig; review: ReportReview }) {
  const [balance, setBalance] = useState(startBalance)
  const [credits, setCredits] = useState(false)
  const [mode, setMode] = useState<HeatMode>('heat')
  const [page, setPage] = useState(1)
  const { scan, evaluation: ev, sources } = review.result
  const blocks = useMemo(() => review.pages.flatMap((p) => p.blocks), [review.pages])
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks])
  const current = review.pages.find((p) => p.n === page) ?? review.pages[0]
  const pageFix = scan.fixations.filter((f) => byId.get(f.id)?.page === current.n)
  const missedIds = scan.missed.map((m) => m.id).filter((id) => byId.get(id)?.page === current.n)
  const date = new Date(review.at).toLocaleDateString(currency === 'inr' ? 'en-IN' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })

  const sourceRow = (Object.keys(SOURCE_NAME).filter((k) => k !== 'resume') as SourceKey[]).map((k) => ({
    k,
    state: sources[k],
  }))

  return (
    <main className="wrap wide">
      <Header active="review" email={email} balance={balance} currency={currency} onRecharge={() => setCredits(true)} />
      {credits ? <Credits currency={currency} need={0} balance={balance} pay={pay} returnTo="review" onClose={() => setCredits(false)} onCredited={setBalance} /> : null}

      <header className="report-head">
        <div>
          <span className="small muted">Review · {date} · {review.fileName}</span>
          <h1 className="report-title">{ev.headline || 'Your review'}</h1>
          <p className="muted" style={{ margin: 0 }}>For {review.roles.join(', ')}</p>
          <div className="sources">
            <span className="src read">Resume</span>
            {sourceRow.map(({ k, state }) => (
              <span key={k} className={`src ${state}`} title={state === 'failed' ? 'We could not read this one' : state === 'skipped' ? 'Not given' : 'Read'}>
                {SOURCE_NAME[k]}
                {state === 'failed' ? ' · not readable' : state === 'skipped' ? ' · not given' : ''}
              </span>
            ))}
          </div>
        </div>
        <div className="head-scores">
          <div><Score value={ev.overall} /><span className="small muted">Overall</span></div>
          <div><Score value={scan.score} /><span className="small muted">6-second scan</span></div>
        </div>
      </header>

      <section className="report-sec">
        <h2>Where a recruiter’s eye goes</h2>
        {scan.six_seconds ? <blockquote className="six">“{scan.six_seconds}”<span>What they take away in six seconds</span></blockquote> : null}
        <div className="scan-grid">
          <div>
            <div className="row heat-tools">
              {(['heat', 'path', 'missed', 'off'] as HeatMode[]).map((x) => (
                <button key={x} className={`tab${mode === x ? ' on' : ''}`} onClick={() => setMode(x)}>
                  {x === 'heat' ? 'Heatmap' : x === 'path' ? 'Scan order' : x === 'missed' ? 'Missed' : 'Plain'}
                </button>
              ))}
              {review.pages.length > 1 ? (
                <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                  {review.pages.map((p) => (
                    <button key={p.n} className={`tab${page === p.n ? ' on' : ''}`} onClick={() => setPage(p.n)}>Page {p.n}</button>
                  ))}
                </span>
              ) : null}
            </div>
            {current.image ? (
              <Heatmap src={`/api/review/${review.id}/page/${current.n}`} alt={`Page ${current.n} of your resume`} blocks={current.blocks} fixations={pageFix} missed={missedIds} mode={mode} />
            ) : (
              <div className="notice">We could not keep an image of this page, so the scan is listed on the right only.</div>
            )}
            {mode === 'heat' ? (
              <div className="legend small muted"><span className="ramp" /> Little attention to most attention{scan.method === 'rules' ? ' · estimated from layout' : ''}</div>
            ) : null}
          </div>
          <div className="scan-notes">
            <h3>The scan, in order</h3>
            <ol className="fix-list">
              {scan.fixations.map((f) => (
                <li key={f.id}>
                  <span className="fix-n">{f.order}</span>
                  <span>
                    <span className="fix-text">{byId.get(f.id)?.text ?? ''}</span>
                    {f.note ? <span className="small muted"> {f.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
            {scan.seen.length ? (
              <>
                <h3>What lands</h3>
                <ul className="plain">{scan.seen.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </>
            ) : null}
            {scan.missed.length ? (
              <>
                <h3>What they skip</h3>
                <ul className="missed-list">
                  {scan.missed.map((x, i) => (
                    <li key={i}>
                      <span className="miss-tag">{String.fromCharCode(65 + i)}</span>
                      <span><b>{x.what}</b> {x.fix}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
        {scan.layout.length ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Layout fixes</h3>
            <ul className="pairs">
              {scan.layout.map((x, i) => (
                <li key={i}><b>{x.issue}</b><span>{x.fix}</span></li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="report-sec">
        <h2>Your resume and profiles</h2>
        <div className="prof-grid">
          {ev.profiles.map((p) => (
            <div className="card prof" key={p.source}>
              <div className="row between">
                <b>{SOURCE_NAME[p.source]}</b>
                <Score value={p.score} />
              </div>
              <Bar value={p.score} />
              <p className="small" style={{ margin: '10px 0' }}>{p.verdict}</p>
              {p.strengths.length ? (
                <>
                  <span className="mini">Working</span>
                  <ul className="plain small">{p.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </>
              ) : null}
              {p.fixes.length ? (
                <>
                  <span className="mini">Fix</span>
                  <ul className="plain small fixes">{p.fixes.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </>
              ) : null}
            </div>
          ))}
        </div>
        {ev.consistency.length ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Where your profiles disagree</h3>
            <ul className="pairs">
              {ev.consistency.map((x, i) => (
                <li key={i}><b>{x.issue}</b><span>{x.fix}</span></li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="report-sec">
        <h2>The roles you want</h2>
        {ev.roles.map((r) => (
          <div className="card role" key={r.role}>
            <div className="row between">
              <div>
                <b className="role-name">{r.role}</b>
                <p className="small muted" style={{ margin: '2px 0 0' }}>{r.verdict}</p>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <Score value={r.fit} label="Fit" />
                <a
                  className="btn sm"
                  href="/jobs"
                  onClick={() => {
                    try {
                      localStorage.setItem('jh_roles', JSON.stringify([r.role]))
                    } catch {}
                  }}
                >
                  Find {r.role} jobs →
                </a>
              </div>
            </div>
            <div className="role-cols">
              {r.strengths.length ? <div><span className="mini">Your edge</span><ul className="plain small">{r.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div> : null}
              {r.gaps.length ? <div><span className="mini">Gaps</span><ul className="plain small">{r.gaps.map((s, i) => <li key={i}>{s}</li>)}</ul></div> : null}
              {r.resume_changes.length ? <div><span className="mini">Change on your resume</span><ul className="plain small fixes">{r.resume_changes.map((s, i) => <li key={i}>{s}</li>)}</ul></div> : null}
            </div>
            {r.keywords.length ? (
              <div className="row small" style={{ gap: 6, marginTop: 8 }}>
                <span className="mini" style={{ margin: 0 }}>Keywords to add</span>
                {r.keywords.map((k) => <span key={k} className="kw">{k}</span>)}
              </div>
            ) : null}
          </div>
        ))}
      </section>

      {ev.rewrites.headline || ev.rewrites.summary || ev.rewrites.bullets.length ? (
        <section className="report-sec">
          <h2>Rewrites, ready to paste</h2>
          {/\[[^\]]+\]/.test(`${ev.rewrites.summary} ${ev.rewrites.bullets.map((b) => b.after).join(' ')}`) ? (
            <p className="small muted">Highlighted brackets are numbers only you know. Fill them in before you paste; we never make them up.</p>
          ) : null}
          {ev.rewrites.headline ? (
            <div className="card">
              <div className="row between"><span className="mini" style={{ margin: 0 }}>LinkedIn headline</span><Copy text={ev.rewrites.headline} /></div>
              <p style={{ margin: '6px 0 0' }}><Fill text={ev.rewrites.headline} /></p>
            </div>
          ) : null}
          {ev.rewrites.summary ? (
            <div className="card">
              <div className="row between"><span className="mini" style={{ margin: 0 }}>Resume summary</span><Copy text={ev.rewrites.summary} /></div>
              <p style={{ margin: '6px 0 0' }}><Fill text={ev.rewrites.summary} /></p>
            </div>
          ) : null}
          {ev.rewrites.bullets.map((b, i) => (
            <div className="card bullet" key={i}>
              <div className="before small">{b.before}</div>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div className="after"><Fill text={b.after} /></div>
                <Copy text={b.after} />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {ev.plan.length ? (
        <section className="report-sec">
          <h2>Your next seven days</h2>
          <ol className="plan">{ev.plan.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </section>
      ) : null}

      <div className="card next-card">
        <div>
          <b>Fixed it? Run it again.</b>
          <p className="small muted" style={{ margin: '2px 0 0' }}>Upload the new version and compare. Every review stays in your saved results.</p>
        </div>
        <div className="row">
          <a className="btn" href="/review">New review · {money(price, currency)}</a>
          <button className="btn ghost sm" onClick={() => window.print()}>Print or save as PDF</button>
        </div>
      </div>
      <p className="footer">Saved to your account. Scores are a recruiter’s-eye estimate, not a promise; the fixes are what moves them.</p>
    </main>
  )
}
