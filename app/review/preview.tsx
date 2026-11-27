'use client'

import { useEffect, useMemo, useState } from 'react'
import Credits, { type PayConfig } from '../credits'
import Header from '../header'
import Heatmap, { type HeatMode } from './heatmap'
import type { Block, Fixation } from '@/lib/layout'
import { type Currency, MIN_CHECKOUT, type Wallet, money } from '@/lib/prices'
import { track } from '@/lib/track'

/** What the free scan shows. The fixes for what the scan skips and the
 *  layout fixes stay on the server: the page only learns how many there are. */
export interface PreviewReview {
  id: string
  at: string
  fileName: string
  roles: string[]
  profiles: number
  pages: Array<{ n: number; width: number; height: number; image: boolean; blocks: Block[] }>
  scan: {
    score: number | null
    six_seconds: string
    fixations: Fixation[]
    seen: string[]
    missed: Array<{ id: string; what: string }>
    layoutFixes: number
    method: 'vision' | 'layout' | 'rules'
  }
}

function tone(score: number | null): string {
  if (score == null) return ''
  return score >= 75 ? ' good' : score >= 50 ? ' fair' : ' weak'
}

export default function Preview({ email, wallet: startWallet, currency, price, pay, review }: { email: string; wallet: Wallet; currency: Currency; price: number; pay: PayConfig; review: PreviewReview }) {
  const [wallet, setWallet] = useState(startWallet)
  const [credits, setCredits] = useState(false)
  const [mode, setMode] = useState<HeatMode>('heat')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { scan } = review
  const m = (n: number) => money(n, currency)
  const byId = useMemo(() => new Map(review.pages.flatMap((p) => p.blocks).map((b) => [b.id, b])), [review.pages])
  const current = review.pages.find((p) => p.n === page) ?? review.pages[0]
  const pageFix = scan.fixations.filter((f) => byId.get(f.id)?.page === current.n)
  const missedIds = scan.missed.map((x) => x.id).filter((id) => byId.get(id)?.page === current.n)
  const short = Math.max(0, price - wallet.balance)

  useEffect(() => {
    track('paywall_shown', { reason: 'review', from: 'review', currency, score: scan.score })
    // Once per page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Same path as the review page: the balance first, then Stripe for the rest.
  async function unlock() {
    setBusy(true)
    setError(null)
    if (short === 0) {
      const r = await fetch('/api/review/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: review.id }) })
        .then((x) => x.json() as Promise<{ ok: boolean; message?: string }>)
        .catch(() => ({ ok: false, message: 'That did not go through. Try again.' }))
      if (r.ok) {
        window.location.href = `/review?review=${review.id}&wait=1`
        return
      }
      setError(r.message ?? 'That did not go through. Try again.')
      setBusy(false)
      return
    }
    if (!pay.stripe) {
      setCredits(true)
      setBusy(false)
      return
    }
    track('checkout_opened', { pack: 'review', amount: Math.max(short, MIN_CHECKOUT[currency]), currency, reason: 'review' })
    const co = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ review_id: review.id, return: 'review' }) })
      .then((x) => x.json() as Promise<{ ok: boolean; message?: string; data?: { url: string } }>)
      .catch(() => ({ ok: false, message: 'Could not open the payment page. Try again.' }) as { ok: boolean; message?: string; data?: { url: string } })
    if (co.ok && co.data?.url) {
      window.location.href = co.data.url
      return
    }
    setError(co.message ?? 'Could not open the payment page. Try again.')
    setBusy(false)
  }

  const date = new Date(review.at).toLocaleDateString(currency === 'inr' ? 'en-IN' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <main className="wrap wide">
      <Header active="review" email={email} wallet={wallet} currency={currency} onRecharge={() => setCredits(true)} />
      {credits ? <Credits currency={currency} wallet={wallet} pay={pay} returnTo="review" onClose={() => setCredits(false)} onCredited={(balance) => setWallet((w) => ({ ...w, balance }))} /> : null}

      <header className="report-head">
        <div>
          <span className="small muted">Free scan · {date} · {review.fileName}</span>
          <h1 className="report-title">Your 6-second scan</h1>
          <p className="muted" style={{ margin: 0 }}>For {review.roles.join(', ')}</p>
        </div>
        <div className="head-scores">
          <div>
            <span className={`score${tone(scan.score)}`}>{scan.score ?? '–'}<small>/100</small></span>
            <span className="small muted">6-second scan</span>
          </div>
        </div>
      </header>

      <section className="report-sec" id="scan">
        {scan.six_seconds ? <blockquote className="six">“{scan.six_seconds}”<span>What a recruiter takes away in six seconds</span></blockquote> : null}
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
            {mode === 'heat' ? <div className="legend small muted"><span className="ramp" /> Little attention to most attention</div> : null}
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
                    <li key={i} className="locked">
                      <span className="miss-tag">{String.fromCharCode(65 + i)}</span>
                      <span><b>{x.what}</b> <span className="blur" aria-hidden="true">How to fix this sits in the full review, written for your resume.</span></span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      </section>

      <div className="unlock">
        <div className="row between">
          <div>
            <b>The full review</b>
            <div className="small muted">Builds on this scan, and adds everything below.</div>
          </div>
          <div className="pay-price">{m(price)}</div>
        </div>
        <ul>
          {scan.missed.length ? <li>How to fix the {scan.missed.length} strong {scan.missed.length === 1 ? 'point' : 'points'} the scan skips</li> : null}
          {scan.layoutFixes ? <li>{scan.layoutFixes} layout {scan.layoutFixes === 1 ? 'fix' : 'fixes'} that win back attention</li> : null}
          <li>{review.profiles ? `Your ${review.profiles} ${review.profiles === 1 ? 'profile' : 'profiles'} checked against your resume` : 'Your resume scored as a whole'}</li>
          <li>Fit and gaps for {review.roles.length === 1 ? review.roles[0] : `each of ${review.roles.length} roles`}, and the keywords recruiters search for</li>
          <li>Rewritten headline, summary and bullets, ready to paste</li>
          <li>A plan for the next seven days</li>
        </ul>
        <div className="row">
          <button className="btn" onClick={unlock} disabled={busy}>
            {busy ? <span className="spin" /> : null}
            {short === 0 ? `Get the full review · ${m(price)}` : wallet.balance > 0 ? `Pay ${m(Math.max(short, MIN_CHECKOUT[currency]))} and get the full review` : `Get the full review · ${m(price)}`}
          </button>
          {short > 0 && pay.stripe ? <span className="small muted">{currency === 'inr' ? 'UPI or card' : 'Card'}, by Stripe.</span> : null}
        </div>
        {error ? <div className="notice err">{error}</div> : null}
        <p className="small muted" style={{ margin: '10px 0 0' }}>If the review does not come through, the full amount goes back to your balance.</p>
      </div>
    </main>
  )
}
