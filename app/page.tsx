import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PRICES } from '@/lib/prices'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  access_denied: 'You denied access on Vaaya. Nothing was connected.',
  state_mismatch: 'That sign-in link expired. Try again.',
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await readSession()
  if (session) redirect('/hunt')
  const { error } = await searchParams
  return (
    <main className="wrap">
      <nav className="nav">
        <span className="brand">
          Job Hunt Agent <span>by Vaaya</span>
        </span>
        <div className="nav-right">
          <a href="https://github.com/ApoorvKhanna/jobhunt-agent">source</a>
        </div>
      </nav>

      <h1>Paste your resume. Get the posting, the person, and the note.</h1>
      <p className="muted">
        Matching jobs from live career sites, the engineering manager or recruiter behind each one, their email,
        and a 120-word note you can send. Every step is priced before you click it, and it runs on your own Vaaya
        credit. New accounts start with a welcome credit, enough for a full round.
      </p>

      {error ? <div className="notice err">{ERRORS[error] ?? `Sign-in failed (${error}).`}</div> : null}

      <p style={{ margin: '20px 0 8px' }}>
        <a className="btn" href="/api/auth/start">
          Sign in with Vaaya
        </a>
      </p>
      <p className="small muted">One click. No card needed to start. You approve exactly two things: spend from your balance, see your balance.</p>

      <h2>What a round costs</h2>
      <div className="steps">
        <div>
          <span>
            Read the resume <span className="price">{PRICES.parse}</span>
          </span>
        </div>
        <div>
          <span>
            Ten matching postings from the last two weeks <span className="price">{PRICES.jobs}</span>
          </span>
        </div>
        <div>
          <span>
            Three people to write to at a company <span className="price">{PRICES.contact}</span>
          </span>
        </div>
        <div>
          <span>
            Reveal one person&apos;s email <span className="price">{PRICES.email}</span>
          </span>
        </div>
        <div>
          <span>
            Draft the note <span className="price">{PRICES.draft}</span>
          </span>
        </div>
      </div>
      <p className="small muted">
        Data from TheirStack and ContactOut, drafting by Claude, all through Vaaya. This app holds no key of its
        own and stores nothing about you: your tokens sit in one encrypted cookie on your browser.
      </p>

      <p className="footer">
        Open source. <Link href="https://github.com/ApoorvKhanna/jobhunt-agent">Read the code</Link>, or run the same
        flow from Claude Code with the bundled skill.
      </p>
    </main>
  )
}
