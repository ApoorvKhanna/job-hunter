// Who to write to at the company. Two rungs, cheapest first. A lookup that
// finds nobody does not use up the run's contact allowance.
//   1. routed people-finder: "managers, founders, recruiters at X"
//   2. ContactOut people search, broad leadership titles, when the first
//      rung found fewer than two people
// Contacts are kept per company, so a second posting at the same company
// shows the same people for free. If both rungs fail upstream, the step
// fails instead of reporting that nobody was found.
import { companyKey, linkedinKey } from '@/lib/format'
import type { Account } from '@/lib/ledger'
import { run, runFor } from '@/lib/provider'
import { caller, readJson, runStepResponse } from '@/lib/route'
import type { Person } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface FindRow { name?: string | null; title?: string | null; company?: string | null; location?: string | null; linkedin?: string | null }

const MANAGER = /engineering manager|head of|director|vp|vice president|cto|chief|founder|co-founder|hiring manager|lead|principal/i
const RECRUIT = /recruit|talent|people|hr\b|human resources/i

function functionWord(jobTitle: string): string {
  if (/design/i.test(jobTitle)) return 'design'
  if (/product manager|product lead|\bpm\b/i.test(jobTitle)) return 'product'
  if (/sales|account executive|sdr|bdr/i.test(jobTitle)) return 'sales'
  if (/marketing|growth/i.test(jobTitle)) return 'marketing'
  if (/data|analyst|scientist|ml|machine learning/i.test(jobTitle)) return 'data'
  if (/engineer|developer|sre|devops|architect|software/i.test(jobTitle)) return 'engineering'
  return 'hiring'
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\b(pvt|ltd|inc|llc|limited|private|technologies|technology|solutions|labs|co)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

function sameCompany(a: string | null | undefined, b: string): boolean {
  if (!a) return true // unknown: keep, the query already named the company
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return true
  const yw = y.split(' ').filter((w) => w.length >= 3)[0]
  return x.includes(y) || y.includes(x) || (!!yw && x.includes(yw))
}

function rank(p: Person, fn: string): number {
  const t = p.title
  let s = 0
  if (MANAGER.test(t)) s += 3
  if (RECRUIT.test(t)) s += 2
  if (new RegExp(fn, 'i').test(t)) s += 2
  if (/intern|associate|executive assistant|sdr\b/i.test(t)) s -= 2
  return s
}

async function rungFind(company: string, domain: string | null, jobTitle: string): Promise<Person[] | null> {
  const fn = functionWord(jobTitle)
  const q = `${fn} managers, heads of ${fn}, founders or technical recruiters at ${company}${domain ? ` (${domain})` : ''}`
  const out = await run<{ rows?: FindRow[] }>('vaaya', 'onefind', { query: q }, 2)
  if (!out.ok) return null
  return (out.data.rows ?? [])
    .filter((r) => r.name && r.linkedin && /linkedin\.com\/in\//i.test(r.linkedin) && sameCompany(r.company, company))
    .map((r) => ({
      name: String(r.name),
      title: String(r.title ?? ''),
      headline: null,
      location: r.location ?? null,
      linkedin_url: String(r.linkedin),
      has_work_email: true, // unknown until we ask; a miss never uses the run
      has_personal_email: false,
    }))
}

async function rungContactOut(account: Account, company: string, jobTitle: string): Promise<Person[] | null> {
  const fn = functionWord(jobTitle)
  const titles = `Founder OR CEO OR CTO OR Co-Founder OR Head OR Director OR VP OR Manager OR Recruiter OR Talent OR HR OR ${fn}`
  const out = await runFor<{ profiles?: Record<string, Record<string, unknown>> }>(
    account,
    'contactout',
    'people-search',
    { job_title: [titles], company: [company], current_titles_only: true, company_filter: 'current', page_size: 5 },
    5,
  )
  if (!out.ok) return null
  return Object.entries(out.data.profiles ?? {})
    .filter(([, p]) => sameCompany(((p.company as { name?: string } | undefined)?.name) ?? null, company))
    .map(([url, p]) => {
      const avail = (p.contact_availability ?? {}) as { work_email?: boolean; personal_email?: boolean }
      return {
        name: String(p.full_name ?? ''),
        title: String(p.headline ?? p.title ?? ''),
        headline: (p.title as string | undefined) ?? null,
        location: (p.location as string | undefined) ?? null,
        linkedin_url: url,
        has_work_email: !!avail.work_email,
        has_personal_email: !!avail.personal_email,
      }
    })
}

export async function POST(req: Request) {
  const { run_id, job_id } = await readJson<{ run_id?: string; job_id?: string }>(req)
  if (!run_id || !job_id) return Response.json({ ok: false, code: 'invalid', message: 'Pick a job from your search' })
  const who = await caller()
  if ('response' in who) return who.response
  const account = who.account
  let company = ''
  return runStepResponse<Person[]>({
    runId: run_id,
    kind: 'contacts',
    check: (r) => {
      const job = r.jobs.find((j) => j.id === job_id)
      if (!job) return 'That job is not part of this search'
      company = companyKey(job.company)
      return null
    },
    cached: (r) => (r.contacts[company]?.length ? r.contacts[company] : undefined),
    key: () => company,
    work: async (r) => {
      const job = r.jobs.find((j) => j.id === job_id)
      if (!job) return null
      return findPeople(account, job.company, job.company_domain, job.title)
    },
    save: (r, people) => {
      r.contacts[company] = people
    },
    miss: 'No managers or recruiters found at this company yet. This lookup did not use your run. You can still draft an email without a contact',
  })
}

/** Null when nobody was found; throws when every rung failed upstream. */
async function findPeople(account: Account, company: string, domain: string | null, title: string): Promise<Person[] | null> {
  const seen = new Set<string>()
  const people: Person[] = []
  const add = (rows: Person[] | null) => {
    for (const p of rows ?? []) {
      const k = linkedinKey(p.linkedin_url)
      if (!seen.has(k)) {
        seen.add(k)
        people.push(p)
      }
    }
  }
  const t0 = Date.now()
  const found = await rungFind(company, domain, title)
  add(found)
  const t1 = Date.now()
  let fallback: Person[] | null | undefined
  if (people.length < 2) {
    fallback = await rungContactOut(account, company, title)
    add(fallback)
  }
  console.log('[contact]', JSON.stringify({ company, title, find_ms: t1 - t0, contactout_ms: fallback === undefined ? 0 : Date.now() - t1, people: people.length }))
  if (people.length === 0) {
    if (found === null && fallback === null) throw new Error('contact_upstream_failed')
    return null
  }
  const fn = functionWord(title)
  people.sort((a, b) => rank(b, fn) - rank(a, fn))
  return people.slice(0, 5)
}
