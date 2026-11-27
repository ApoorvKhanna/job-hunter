'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import CopyButton from '../copy-button'
import Credits, { type PayConfig } from '../credits'
import Header from '../header'
import Icon from '../icons'
import Heatmap, { type HeatMode } from './heatmap'
import ShareScore from './share'
import type { Block } from '@/lib/layout'
import type { Links, SourceKey } from '@/lib/links'
import { type Currency, type Wallet, money } from '@/lib/prices'
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

/** A report is opened rarely, so its scores may count up once as they come
 *  into view (frequency of use). Everything else stays still. */
function Score({ value, label }: { value: number | null; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState<number | null>(value)
  useEffect(() => {
    const el = ref.current
    if (value == null || !el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof IntersectionObserver === 'undefined') return
    let raf = 0
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      io.disconnect()
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 520)
        setShown(Math.round(value * (1 - (1 - t) ** 3)))
        if (t < 1) raf = requestAnimationFrame(tick)
      }
      setShown(0)
      raf = requestAnimationFrame(tick)
    })
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [value])
  return (
    <span ref={ref} className={`score${tone(value)}`} title={label}>
      {shown ?? '–'}
      <small>/100</small>
    </span>
  )
}

/** Staging: sections that start below the fold ease in as they arrive.
 *  Anything already on screen is left alone, so nothing flashes. */
function useReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const below = Array.from(document.querySelectorAll<HTMLElement>('.reveal')).filter((el) => el.getBoundingClientRect().top > window.innerHeight)
    below.forEach((el) => el.classList.add('pending'))
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.classList.remove('pending')
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    below.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

const SECTIONS = [
  { id: 'scan', label: 'Eye scan' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'roles', label: 'Roles' },
  { id: 'rewrites', label: 'Rewrites' },
  { id: 'plan', label: 'Your week' },
] as const

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

export default function Report({ email, wallet: startWallet, currency, price, pay, review }: { email: string; wallet: Wallet; currency: Currency; price: number; pay: PayConfig; review: ReportReview }) {
  const [wallet, setWallet] = useState(startWallet)
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
  useReveal()

  // Miller: the three things to do first, before the full detail.
  const startHere = (ev.plan.length ? ev.plan : [...scan.missed.map((m) => m.fix), ...ev.profiles.flatMap((p) => p.fixes)]).slice(0, 3)
  const hasRewrites = !!(ev.rewrites.headline || ev.rewrites.summary || ev.rewrites.bullets.length)
  const sections = SECTIONS.filter((x) => (x.id === 'rewrites' ? hasRewrites : x.id === 'plan' ? ev.plan.length > 0 : true))

  // The index follows you down the page, like a docs site.
  const [here, setHere] = useState<string>('scan')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setHere(top.target.id)
      },
      { rootMargin: '-64px 0px -60% 0px' },
    )
    document.querySelectorAll('.report-sec[id]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  const sourceRow = (Object.keys(SOURCE_NAME).filter((k) => k !== 'resume') as SourceKey[]).map((k) => ({
    k,
    state: sources[k],
  }))

  return (
    <main className="wrap wide">
      <Header active="review" email={email} wallet={wallet} currency={currency} onRecharge={() => setCredits(true)} />
      {credits ? <Credits currency={currency} wallet={wallet} pay={pay} returnTo="review" onClose={() => setCredits(false)} onCredited={(balance) => setWallet((w) => ({ ...w, balance }))} /> : null}

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
        <div className="head-side">
          <div className="head-scores">
            <div><Score value={ev.overall} /><span className="small muted">Overall</span></div>
            <div><Score value={scan.score} /><span className="small muted">6-second scan</span></div>
          </div>
          <ShareScore reviewId={review.id} score={scan.score} />
        </div>
      </header>

      {startHere.length ? (
        <div className="start-here">
          <span className="mini" style={{ margin: 0 }}>Start here</span>
          <ol>{startHere.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      ) : null}

      <nav className="secnav" aria-label="Report sections">
        <div className="rail">
          {sections.map((x) => <a key={x.id} href={`#${x.id}`} className={here === x.id ? 'on' : ''} aria-current={here === x.id ? 'true' : undefined}>{x.label}</a>)}
        </div>
      </nav>

      <section className="report-sec" id="scan">
        <h2>Where a recruiter’s eye goes</h2>
        {scan.six_seconds ? <blockquote className="six">“{scan.six_seconds}”<span>What they take away in six seconds</span></blockquote> : null}
        <div className="scan-grid">
          <div>
            <div className="row heat-tools">
              <div className="seg" role="tablist" aria-label="View">
                {(['heat', 'path', 'missed'] as HeatMode[]).map((x) => (
                  <button key={x} role="tab" aria-selected={mode === x} className={mode === x ? 'on' : ''} onClick={() => setMode(x)}>
                    {x === 'heat' ? 'Heatmap' : x === 'path' ? 'Scan order' : 'Missed'}
                  </button>
                ))}
              </div>
              {review.pages.length > 1 ? (
                <div className="seg" role="tablist" aria-label="Page" style={{ marginLeft: 'auto' }}>
                  {review.pages.map((p) => (
                    <button key={p.n} role="tab" aria-selected={page === p.n} className={page === p.n ? 'on' : ''} onClick={() => setPage(p.n)}>Page {p.n}</button>
                  ))}
                </div>
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

      <section className="report-sec reveal" id="profiles">
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

      <section className="report-sec" id="roles">
        <h2>The roles you want</h2>
        {ev.roles.map((r) => (
          <div className="card role reveal" key={r.role}>
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
                  Find {r.role} jobs <Icon name="arrow" size={14} weight={500} />
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
        <section className="report-sec reveal" id="rewrites">
          <h2>Rewrites, ready to paste</h2>
          {/\[[^\]]+\]/.test(`${ev.rewrites.summary} ${ev.rewrites.bullets.map((b) => b.after).join(' ')}`) ? (
            <p className="small muted">Highlighted brackets are numbers only you know. Fill them in before you paste; we never make them up.</p>
          ) : null}
          {ev.rewrites.headline ? (
            <div className="card">
              <div className="row between"><span className="mini" style={{ margin: 0 }}>LinkedIn headline</span><CopyButton text={ev.rewrites.headline} /></div>
              <p style={{ margin: '6px 0 0' }}><Fill text={ev.rewrites.headline} /></p>
            </div>
          ) : null}
          {ev.rewrites.summary ? (
            <div className="card">
              <div className="row between"><span className="mini" style={{ margin: 0 }}>Resume summary</span><CopyButton text={ev.rewrites.summary} /></div>
              <p style={{ margin: '6px 0 0' }}><Fill text={ev.rewrites.summary} /></p>
            </div>
          ) : null}
          {ev.rewrites.bullets.map((b, i) => (
            <div className="card bullet" key={i}>
              <div className="before small">{b.before}</div>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div className="after"><Fill text={b.after} /></div>
                <CopyButton text={b.after} />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {ev.plan.length ? (
        <section className="report-sec reveal" id="plan">
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
