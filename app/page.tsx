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
    <main className="wrap">
      <nav className="nav">
        <span className="brand">Job Hunter</span>
        <span className="nav-right small">₹49 free to start</span>
      </nav>

      <h1>Upload your resume. Get the job, the person hiring, and the note.</h1>
      <p className="muted">
        Fresh postings that match you, the manager or recruiter behind each one, their email, and a short note
        you can send today. Pay per step, in rupees, only when it works.
      </p>

      {error ? <div className="notice err">{ERRORS[error] ?? `Sign-in failed (${error}).`}</div> : null}

      <p style={{ margin: '20px 0 8px' }}>
        <a className="btn" href="/api/auth/google/start" aria-disabled={!GOOGLE_CLIENT_ID}>
          <GoogleMark /> Continue with Google
        </a>
      </p>
      <p className="small muted">Every new account starts with ₹49. Recharge by UPI when it runs out.</p>

      <h2>What a step costs</h2>
      <div className="steps">
        <div><span>Read your resume <span className="price">{inr(PRICE_PAISE.parse)}</span></span></div>
        <div><span>Ten matching postings from the last two weeks <span className="price">{inr(PRICE_PAISE.jobs)}</span></span></div>
        <div><span>Three people to write to at a company <span className="price">{inr(PRICE_PAISE.contact)}</span></span></div>
        <div><span>Reveal one person&apos;s email <span className="price">{inr(PRICE_PAISE.email)}</span></span></div>
        <div><span>Draft the note <span className="price">{inr(PRICE_PAISE.draft)}</span></span></div>
      </div>
      <p className="small muted">A failed step is never charged. Your resume stays in your browser.</p>
    </main>
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
