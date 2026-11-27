'use client'

import { useState } from 'react'
import Credits, { type PayConfig } from '../credits'
import Header from '../header'
import Icon from '../icons'
import { type Currency, LEGACY_EMAIL_PRICE, REVIEW_PRICE, type Wallet, money } from '@/lib/prices'

export default function Home({
  email,
  firstName,
  wallet: startWallet,
  currency,
  pay,
  notice,
  counts,
  lastReview,
}: {
  email: string
  firstName: string
  wallet: Wallet
  currency: Currency
  pay: PayConfig
  notice: string | null
  counts: { jobs: number; drafts: number; contacts: number; reviews: number }
  lastReview: { id: string; at: string; roles: string[]; overall: number | null } | null
}) {
  const [wallet, setWallet] = useState(startWallet)
  const [credits, setCredits] = useState(false)
  const m = (n: number) => money(n, currency)
  const emailsNow = wallet.emails + Math.floor(wallet.balance / LEGACY_EMAIL_PRICE[currency])

  return (
    <main className="wrap wide">
      <Header active="home" email={email} wallet={wallet} currency={currency} onRecharge={() => setCredits(true)} />
      {notice ? <div className="notice ok">{notice}</div> : null}
      {credits ? <Credits currency={currency} wallet={wallet} pay={pay} returnTo="app" onClose={() => setCredits(false)} onCredited={(balance) => setWallet((w) => ({ ...w, balance }))} /> : null}

      <h1 className="choose-title">{firstName ? `${firstName}, what` : 'What'} do you want to do today?</h1>
      <p className="muted" style={{ marginTop: -4 }}>
        Searching and finding the people hiring are free. {emailsNow > 0 ? `You have ${emailsNow} ${emailsNow === 1 ? 'email' : 'emails'} to reveal.` : 'You pay only for the emails you reveal.'}
      </p>

      <div className="choose">
        <a className="choice" href="/jobs">
          <span className="choice-kicker">Free to search · pay per email</span>
          <span className="choice-head"><Icon name="search" size={22} weight={600} /><b>Find jobs and the people hiring</b></span>
          <span className="choice-body">Upload your resume. Get fresh openings that fit, the managers and recruiters at each company, their email, and a note written from your experience.</span>
          <span className="choice-prices">
            <span>Read resume <i>Free</i></span>
            <span>Job search <i>Free</i></span>
            <span>People hiring <i>Free</i></span>
            <span>Their email <i>1 credit</i></span>
            <span>Your note <i>Free</i></span>
          </span>
          {counts.jobs + counts.drafts + counts.contacts > 0 ? (
            <span className="choice-past">{counts.jobs} saved jobs · {counts.contacts} contacts · {counts.drafts} drafts</span>
          ) : null}
          <span className="btn">Start a job search <Icon name="arrow" size={15} weight={500} /></span>
        </a>

        <a className="choice feature" href="/review">
          <span className="choice-kicker">Free 6-second scan · full review {m(REVIEW_PRICE[currency])}</span>
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
          <span className="btn">Scan my resume free <Icon name="arrow" size={15} weight={500} /></span>
        </a>
      </div>

      <p className="footer">Everything you get is saved to your account and free to reopen. <a href="/saved">Saved results →</a></p>
    </main>
  )
}
