import { redirect } from 'next/navigation'
import { GOOGLE_CLIENT_ID } from '@/lib/env'
import { visitorCurrency } from '@/lib/ledger'
import { PACKS, REVIEW_PRICE, money } from '@/lib/prices'
import { readSession } from '@/lib/session'
import Icon from './icons'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  access_denied: 'You cancelled the Google sign-in.',
  state_mismatch: 'That sign-in link expired. Try again.',
  google_failed: 'Google did not confirm your account. Try again.',
  not_configured: 'Sign-in is not set up yet.',
  one_per_network: 'One account per network. Sign in with the Google account you first used here.',
  blocked: 'This account is not able to use Job Hunter.',
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await readSession()
  if (session) redirect('/app')
  const { error } = await searchParams
  const c = await visitorCurrency()
  const m = (n: number) => money(n, c)
  const from = m(PACKS[0].price[c])
  return (
    <main className="landing">
      <nav className="nav">
        <span className="brand">Job Hunter</span>
        <span className="nav-right small">Free to search · your first email is on us</span>
      </nav>

      <section className="hero">
        <div className="hero-text">
          <h1>Find jobs that fit. Know who to contact.</h1>
          <p className="muted">
            Search fresh openings and find the people hiring, free. Pay only for the emails you reveal. Or see your resume
            the way a recruiter does in the first six seconds, also free.
          </p>
          {error ? <div className="notice err">{ERRORS[error] ?? `Sign-in failed (${error}).`}</div> : null}
          <p style={{ margin: '18px 0 8px' }}>
            <a className="btn" href="/api/auth/google/start" aria-disabled={!GOOGLE_CLIENT_ID}>
              <GoogleMark /> Continue with Google
            </a>
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            Free to start, and your first email is on us. Email packs from {from} {c === 'inr' ? 'by UPI or card' : 'by card'}.
          </p>
        </div>
        <div className="art-wrap"><img className="art" src="/odyssey.jpg" alt="A figure in a red cloak on marble steps beneath an arch, a moon in a deep blue sky, red roses below" /></div>
      </section>

      <h2 className="lane-title">What you get <span>One example, start to finish</span></h2>
      <div className="example" aria-label="An example result">
        <div>
          <span className="ex-k">The job</span>
          <span className="ex-v">Senior Product Manager, Payments</span>
          <div className="ex-m">A Series B fintech · Bengaluru · posted 3 days ago</div>
        </div>
        <div>
          <span className="ex-k">The person hiring</span>
          <span className="ex-v">Priya S., Head of Product</span>
          <div className="ex-m">Picked from the managers and recruiters at the company, with their LinkedIn</div>
        </div>
        <div>
          <span className="ex-k">Their email</span>
          <span className="ex-mail">priya.s@••••••••.com</span>
          <div className="ex-m">Their work address, so your note skips the job portal</div>
        </div>
        <div>
          <span className="ex-k">Your note</span>
          <span className="ex-note">“Hi Priya, I led the UPI AutoPay rollout at my last company and took mandate success from 61% to 84%…”</span>
          <div className="ex-m">Written from your resume and the posting</div>
        </div>
      </div>
      <p className="example-cap">An illustration with the details changed. Yours comes from your resume and live postings.</p>

      <h2 className="lane-title">Job hunt <span>Free to search. Pay only for emails.</span></h2>
      <div className="stepgrid">
        <div>
          <span className="num">I</span><Icon name="resume" size={18} weight={600} />
          <b>Add your resume</b>
          Upload a PDF or DOCX, or paste the text. We suggest job titles from your experience.
          <span className="price">Free</span>
        </div>
        <div>
          <span className="num">II</span><Icon name="search" size={18} weight={600} />
          <b>Find matching jobs</b>
          Adjust titles, country and date range, then search recent openings.
          <span className="price">Free</span>
        </div>
        <div>
          <span className="num">III</span><Icon name="people" size={18} weight={600} />
          <b>Find contacts</b>
          Managers and recruiters at the company.
          <span className="price">Free</span>
        </div>
        <div>
          <span className="num">IV</span><Icon name="mail" size={18} weight={600} />
          <b>Get their email</b>
          The work email of the person you choose. Only used when one is found.
          <span className="price">1 email credit</span>
        </div>
        <div>
          <span className="num">V</span><Icon name="pen" size={18} weight={600} />
          <b>Draft your note</b>
          Written from your experience and the role. Review it, send it when ready.
          <span className="price">Free</span>
        </div>
      </div>

      <p className="small muted" style={{ margin: '10px 0 0' }}>
        Emails come in packs that never expire: {PACKS.map((k) => `${k.emails} for ${m(k.price[c])}`).join(', ')}. Every pack adds deep searches, which look through a second, larger job database when the free search comes back thin. Free searches have a daily limit.
      </p>

      <h2 className="lane-title">Resume and profile review <span>6-second scan free · full review {m(REVIEW_PRICE[c])}</span></h2>
      <div className="stepgrid four">
        <div>
          <Icon name="eye" size={18} weight={600} />
          <b>Where the eye goes</b>
          A heatmap of what a recruiter sees in the first six seconds, and the strong points they skip.
          <span className="price">Free</span>
        </div>
        <div>
          <Icon name="profile" size={18} weight={600} />
          <b>Your profiles, checked</b>
          LinkedIn, X, GitHub and your website, read against your resume. Add the ones you have.
        </div>
        <div>
          <Icon name="star" size={18} weight={600} />
          <b>Fit for each role</b>
          Up to three target roles: your fit, the gaps, and the keywords recruiters search for.
        </div>
        <div>
          <Icon name="pen" size={18} weight={600} />
          <b>What to change</b>
          A rewritten headline, summary and bullets, plus a plan for the next seven days. Saved to your account.
        </div>
      </div>

      <p className="footer">An email credit is used only when an email is found. Your reviews, jobs, emails and drafts are saved automatically and free to reopen.</p>
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
