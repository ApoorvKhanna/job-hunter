'use client'

import { useState } from 'react'
import Credits, { type PayConfig } from '../credits'
import Header from '../header'
import Icon from '../icons'
import { type Currency, PRICES, REVIEW_PRICE, money } from '@/lib/prices'

export default function Home({
  email,
  firstName,
  balance: startBalance,
  currency,
  pay,
  notice,
  counts,
  lastReview,
}: {
  email: string
  firstName: string
  balance: number
  currency: Currency
  pay: PayConfig
  notice: string | null
  counts: { jobs: number; drafts: number; contacts: number; reviews: number }
  lastReview: { id: string; at: string; roles: string[]; overall: number | null } | null
}) {
  const [balance, setBalance] = useState(startBalance)
  const [credits, setCredits] = useState(false)
  const p = PRICES[currency]
  const m = (n: number) => money(n, currency)
  const searches = Math.floor(balance / p.jobs)

  return (
    <main className="wrap wide">
      <Header active="home" email={email} balance={balance} currency={currency} onRecharge={() => setCredits(true)} />
      {notice ? <div className="notice ok">{notice}</div> : null}
      {credits ? <Credits currency={currency} need={0} balance={balance} pay={pay} returnTo="app" onClose={() => setCredits(false)} onCredited={setBalance} /> : null}

      <h1 className="choose-title">{firstName ? `${firstName}, what` : 'What'} do you want to do today?</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        Two ways in, one balance. {balance > 0 ? `Your ${m(balance)} covers ${searches > 0 ? `${searches} job ${searches === 1 ? 'search' : 'searches'}` : 'a few steps'}.` : ''}
      </p>

      <div className="choose">
        <a className="choice" href="/jobs">
          <span className="choice-kicker">Pay per step</span>
          <span className="choice-head"><Icon name="search" size={22} weight={600} /><b>Find jobs and the people hiring</b></span>
          <span className="choice-body">Upload your resume. Get fresh openings that fit, the managers and recruiters at each company, their email, and a note written from your experience.</span>
          <span className="choice-prices">
            <span>Read resume <i>Free</i></span>
            <span>Job search <i>{m(p.jobs)}</i></span>
            <span>Contacts <i>{m(p.contact)}</i></span>
            <span>Email <i>{m(p.email)}</i></span>
            <span>Draft <i>{m(p.draft)}</i></span>
          </span>
          {counts.jobs + counts.drafts + counts.contacts > 0 ? (
            <span className="choice-past">{counts.jobs} saved jobs · {counts.contacts} contacts · {counts.drafts} drafts</span>
          ) : null}
          <span className="btn">Start a job search <Icon name="arrow" size={15} weight={500} /></span>
        </a>

        <a className="choice feature" href="/review">
          <span className="choice-kicker">One price, all included</span>
          <span className="choice-head"><Icon name="eye" size={22} weight={600} /><b>Resume and profile review</b></span>
          <span className="choice-body">See where a recruiter’s eye lands on your resume in the first six seconds. We check your LinkedIn, X, GitHub and website against the roles you want, then tell you exactly what to fix.</span>
          <span className="choice-list">
            <span>Eye-tracking heatmap of your resume</span>
            <span>LinkedIn, X, GitHub and site check</span>
            <span>Fit and gaps for each target role</span>
            <span>Rewritten headline, summary and bullets</span>
          </span>
          {lastReview ? (
            <span className="choice-past">
              Last review{lastReview.overall != null ? `: ${lastReview.overall}/100` : ''} for {lastReview.roles.join(', ')}
            </span>
          ) : null}
          <span className="btn">Start a review · {m(REVIEW_PRICE[currency])} <Icon name="arrow" size={15} weight={500} /></span>
        </a>
      </div>

      <p className="footer">Everything you get is saved to your account and free to reopen. <a href="/saved">Saved results →</a></p>
    </main>
  )
}
