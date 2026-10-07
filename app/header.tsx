'use client'

import { RUN_CENTS, usd } from '@/lib/prices'

export type TabId = 'search' | 'saved'

// The signed-in header. Every tab renders exactly this, so the balance,
// Add funds and sign out never move or disappear as you switch tabs.
export default function Header({ active, email, balance, onAddFunds }: { active: TabId; email: string; balance: number; onAddFunds: () => void }) {
  const tab = (id: TabId, href: string, label: string) =>
    active === id ? <span className="navlink on">{label}</span> : <a className="navlink" href={href}>{label}</a>
  return (
    <nav className="nav">
      <a className="brand" href="/">Job Hunter</a>
      <div className="nav-right">
        {tab('search', '/app', 'Find jobs')}
        {tab('saved', '/saved', 'Saved')}
        <span className={`balance${balance < RUN_CENTS ? ' low' : ''}`}>
          <span className="amt" title={`Balance for ${email}`}><span className="amt-label">Balance:</span> {usd(balance)}</span>
          <button className="go" onClick={onAddFunds}>Add funds</button>
        </span>
        <form action="/api/auth/logout" method="post"><button className="btn ghost sm" type="submit">Sign out</button></form>
      </div>
    </nav>
  )
}
