'use client'

import { type Currency, money } from '@/lib/prices'

export type TabId = 'home' | 'jobs' | 'review' | 'saved'

// The signed-in header. Every page renders exactly this, so the balance,
// Add credits and sign out never move or disappear as you switch tabs.
export default function Header({ active, email, balance, currency, onRecharge }: { active: TabId; email: string; balance: number; currency: Currency; onRecharge: () => void }) {
  const tab = (id: TabId, href: string, label: string) =>
    active === id ? <span className="navlink on">{label}</span> : <a className="navlink" href={href}>{label}</a>
  const low = balance < (currency === 'inr' ? 4000 : 75)
  return (
    <nav className="nav">
      <a className="brand" href="/app">Job Hunter</a>
      <div className="nav-right">
        {tab('jobs', '/jobs', 'Find jobs')}
        {tab('review', '/review', 'Resume review')}
        {tab('saved', '/saved', 'Saved')}
        <span className={`balance${low ? ' low' : ''}`}>
          <span className="amt" title={`Balance for ${email}`}><span className="amt-label">Balance:</span> {money(balance, currency)}</span>
          <button className="go" onClick={onRecharge}>Add credits</button>
        </span>
        <form action="/api/auth/logout" method="post"><button className="btn ghost sm" type="submit">Sign out</button></form>
      </div>
    </nav>
  )
}
