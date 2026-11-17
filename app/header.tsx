'use client'

import { useEffect, useRef, useState } from 'react'
import { type Currency, money } from '@/lib/prices'

export type TabId = 'home' | 'jobs' | 'review' | 'saved'

// The signed-in header. Every page renders exactly this, so the balance,
// Add credits and sign out never move or disappear as you switch tabs.
export default function Header({ active, email, balance, currency, onRecharge }: { active: TabId; email: string; balance: number; currency: Currency; onRecharge: () => void }) {
  const tab = (id: TabId, href: string, label: string) =>
    active === id ? <span className="navlink on" aria-current="page">{label}</span> : <a className="navlink" href={href}>{label}</a>
  const low = balance < (currency === 'inr' ? 4000 : 75)

  // Squash & stretch when money lands. A debit happens many times a session,
  // so it changes the number quietly (frequency of use).
  const prev = useRef(balance)
  const [bump, setBump] = useState(false)
  useEffect(() => {
    if (balance > prev.current) {
      setBump(true)
      const t = setTimeout(() => setBump(false), 320)
      prev.current = balance
      return () => clearTimeout(t)
    }
    prev.current = balance
  }, [balance])

  return (
    <nav className="nav">
      <a className="brand" href="/app">Job Hunter</a>
      <div className="nav-right">
        {tab('jobs', '/jobs', 'Find jobs')}
        {tab('review', '/review', 'Resume review')}
        {tab('saved', '/saved', 'Saved')}
        <span className={`balance${low ? ' low' : ''}${bump ? ' bump' : ''}`}>
          <span className="amt" title={`Balance for ${email}`}><span className="amt-label">Balance:</span> {money(balance, currency)}</span>
          <button className="go" onClick={onRecharge}>Add credits</button>
        </span>
        <form action="/api/auth/logout" method="post"><button className="btn ghost sm" type="submit">Sign out</button></form>
      </div>
    </nav>
  )
}
