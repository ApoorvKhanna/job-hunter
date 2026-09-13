'use client'

import { inr } from '@/lib/prices'

export type TabId = 'search' | 'saved'

// The signed-in header. Every tab renders exactly this, so the balance,
// Recharge and sign out never move or disappear as you switch tabs.
export default function Header({ active, email, balance, onRecharge }: { active: TabId; email: string; balance: number; onRecharge: () => void }) {
  const tab = (id: TabId, href: string, label: string) =>
    active === id ? <span className="navlink on">{label}</span> : <a className="navlink" href={href}>{label}</a>
  return (
    <nav className="nav">
      <a className="brand" href="/">Job Hunter</a>
      <div className="nav-right">
        {tab('search', '/app', 'Search')}
        {tab('saved', '/saved', 'Saved')}
        <span className={`balance${balance < 2000 ? ' low' : ''}`}>
          <span className="amt" title={`Balance for ${email}`}>{inr(balance)}</span>
          <button className="go" onClick={onRecharge}>Recharge</button>
        </span>
        <form action="/api/auth/logout" method="post"><button className="btn ghost sm" type="submit">sign out</button></form>
      </div>
    </nav>
  )
}
