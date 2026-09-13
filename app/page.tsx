import { redirect } from 'next/navigation'
import { GOOGLE_CLIENT_ID } from '@/lib/env'
import { PRICE_PAISE, inr } from '@/lib/prices'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  access_denied: 'You cancelled the Google sign-in.',
  state_mismatch: 'That sign-in link expired. Try again.',
  google_failed: 'Google did not confirm your account. Try again.',
  not_configured: 'Sign-in is not set up yet.',
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await readSession()
  if (session) redirect('/app')
  const { error } = await searchParams
  return (
    <main className="landing">
      <nav className="nav">
        <span className="brand">Job Hunter</span>
        <span className="nav-right small">₹49 in granted credits</span>
      </nav>

      <section className="hero">
        <div>
          <h1>Find jobs that fit. Know who to contact.</h1>
          <p className="muted">
            Upload your resume to find recent openings, relevant contacts at each company, and an email draft based on
            your experience. Choose each step as you go. Pay per step. Failed steps aren’t charged.
          </p>
          {error ? <div className="notice err">{ERRORS[error] ?? `Sign-in failed (${error}).`}</div> : null}
          <p style={{ margin: '18px 0 8px' }}>
            <a className="btn" href="/api/auth/google/start" aria-disabled={!GOOGLE_CLIENT_ID}>
              <GoogleMark /> Continue with Google
            </a>
          </p>
          <p className="small muted" style={{ margin: 0 }}>Start with ₹49 in granted credits. Add more with UPI whenever you need them.</p>
        </div>
        <Arch />
      </section>

      <div className="stepgrid">
        <div>
          <span className="num">I</span><Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />
          <b>Sign in</b>
          Get ₹49 in granted credits. Your jobs, emails and drafts are saved to your account.
        </div>
        <div>
          <span className="num">II</span><Icon d="M7 3h7l4 4v14H7Zm7 0v4h4M9.5 12h5M9.5 15.5h5" />
          <b>Add your resume</b>
          Upload a PDF or DOCX, or paste the text. We suggest job titles from your experience.
          <span className="price">{inr(PRICE_PAISE.parse)}</span>
        </div>
        <div>
          <span className="num">III</span><Icon d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1.5L20 20" />
          <b>Find matching jobs</b>
          Adjust titles, country and date range, then search recent openings.
          <span className="price">{inr(PRICE_PAISE.jobs)}</span>
        </div>
        <div>
          <span className="num">IV</span><Icon d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 8a5 5 0 0 1 10 0M16 10a2.5 2.5 0 1 0 0-5M17 14.5a4 4 0 0 1 3 4.5" />
          <b>Find contacts</b>
          Managers and recruiters at the company. Look up an email for the one you choose.
          <span className="price">{inr(PRICE_PAISE.contact)} · email {inr(PRICE_PAISE.email)}</span>
        </div>
        <div>
          <span className="num">V</span><Icon d="M4 6h16v12H4Zm0 1 8 6 8-6" />
          <b>Prepare your email</b>
          A draft from your experience and the role. Review it, copy it, send it when ready.
          <span className="price">{inr(PRICE_PAISE.draft)}</span>
        </div>
      </div>

      <p className="footer">Failed steps aren’t charged. Your jobs, revealed emails and drafts are saved automatically and free to reopen.</p>
    </main>
  )
}

function Icon({ d }: { d: string }) {
  return (
    <svg className="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** The arch from the paintings: marble columns, a lapis sky, steps, one figure. */
function Arch() {
  return (
    <svg className="art" viewBox="0 0 360 320" aria-hidden="true">
      <rect width="360" height="320" fill="#e9e3d5" />
      <path d="M80 300V150a100 100 0 0 1 200 0v150Z" fill="#1e2f96" />
      <circle cx="222" cy="112" r="13" fill="#f6f3ea" />
      <g fill="#d4cdbb">
        <rect x="40" y="130" width="40" height="170" />
        <rect x="280" y="130" width="40" height="170" />
        <rect x="32" y="116" width="56" height="14" />
        <rect x="272" y="116" width="56" height="14" />
        <rect x="0" y="0" width="360" height="26" />
      </g>
      <g stroke="#bfb8a6" strokeWidth="2">
        <path d="M50 130v170M60 130v170M70 130v170M290 130v170M300 130v170M310 130v170" />
        <path d="M0 26h360" />
      </g>
      <g fill="#dcd6c6">
        <rect x="70" y="258" width="220" height="14" />
        <rect x="45" y="272" width="270" height="14" />
        <rect x="20" y="286" width="320" height="14" />
        <rect x="0" y="300" width="360" height="20" />
      </g>
      <g stroke="#c9c2b0" strokeWidth="1">
        <path d="M70 258h220M45 272h270M20 286h320M0 300h360" />
      </g>
      <path d="M180 228l-9 30h18Z" fill="#b3261e" />
      <circle cx="180" cy="221" r="5.5" fill="#b8902e" />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
