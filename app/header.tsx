'use client'

import { useEffect, useRef, useState } from 'react'
import posthog from 'posthog-js'
import { analyticsOn } from '@/lib/analytics'
import { type Currency, LEGACY_EMAIL_PRICE, type Wallet, money } from '@/lib/prices'

export type TabId = 'home' | 'jobs' | 'review' | 'saved'

// The signed-in header. Every page renders exactly this, so the emails left,
// Get emails and sign out never move or disappear as you switch tabs.
export default function Header({ active, email, wallet, currency, onRecharge }: { active: TabId; email: string; wallet: Wallet; currency: Currency; onRecharge: () => void }) {
  // Tie this browser's PostHog events to the signed-in account.
  useEffect(() => {
    if (email && analyticsOn()) posthog.identify(email, { email, currency })
  }, [email, currency])
  const tab = (id: TabId, href: string, label: string) =>
    active === id ? <span className="navlink on" aria-current="page">{label}</span> : <a className="navlink" href={href}>{label}</a>
  const low = wallet.emails === 0 && wallet.balance < LEGACY_EMAIL_PRICE[currency]

  // Squash & stretch when emails or money land. Spending happens many times
  // a session, so it changes the number quietly (frequency of use).
  const worth = wallet.emails * 1000 + wallet.deep * 100 + wallet.balance
  const prev = useRef(worth)
  const [bump, setBump] = useState(false)
  useEffect(() => {
    if (worth > prev.current) {
      setBump(true)
      const t = setTimeout(() => setBump(false), 320)
      prev.current = worth
      return () => clearTimeout(t)
    }
    prev.current = worth
  }, [worth])

  const title = [
    `${wallet.emails} ${wallet.emails === 1 ? 'email' : 'emails'} left`,
    wallet.deep > 0 ? `${wallet.deep} deep ${wallet.deep === 1 ? 'search' : 'searches'}` : '',
    wallet.balance > 0 ? `${money(wallet.balance, currency)} balance` : '',
  ].filter(Boolean).join(', ')

  return (
    <nav className="nav">
      <a className="brand" href="/app">Job Hunter</a>
      <div className="nav-right">
        {tab('jobs', '/jobs', 'Find jobs')}
        {tab('review', '/review', 'Resume review')}
        {tab('saved', '/saved', 'Saved')}
        <span className={`balance${low ? ' low' : ''}${bump ? ' bump' : ''}`}>
          {/* One number, so the header never wraps: emails, or for an older
              account with money and no credits, the money. The rest is in
              the tooltip. */}
          <span className="amt" title={`${title}, for ${email}`}>
            {wallet.emails === 0 && wallet.balance > 0
              ? <><span className="amt-label">Balance:</span> {money(wallet.balance, currency)}</>
              : <><span className="amt-label">Emails:</span> {wallet.emails}</>}
          </span>
          <button className="go" onClick={onRecharge}>Get emails</button>
        </span>
        <form action="/api/auth/logout" method="post" onSubmit={() => { if (analyticsOn()) posthog.reset() }}><button className="btn ghost sm" type="submit">Sign out</button></form>
      </div>
    </nav>
  )
}
