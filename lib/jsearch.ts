// JSearch (OpenWeb Ninja, via RapidAPI) — the cheap job source.
// Google Jobs under the hood, so it sees company career pages, LinkedIn,
// Indeed and the rest. Roughly 100x cheaper per job than the previous
// vendor, which is what turns the jobs step from a loss into a margin.
//
// What we give up vs TheirStack: naukri.com listings, normalized salary
// bands and a seniority label. Salary comes through when the publisher
// states it; seniority we no longer use at all.
import { COUNTRIES } from './countries'
import { JOBS_VIA_PROVIDER, JSEARCH_API_KEY } from './env'
import type { Account } from './ledger'
import { runFor } from './provider'
import type { Job } from './types'

// OpenWeb Ninja's direct API (not the RapidAPI listing): different host and a
// plain X-API-Key header.
const ENDPOINT = 'https://api.openwebninja.com/jsearch/search'

export interface JSearchQuery {
  titles: string[]
  countryCode: string | null
  remoteOnly: boolean
  days: number
  page: number
  /** Override the date bucket; the cascade uses this to retry wider. */
  bucket?: string
}

interface RawJob {
  job_id?: string
  job_title?: string
  employer_name?: string
  employer_website?: string | null
  job_publisher?: string
  job_apply_link?: string
  job_description?: string
  job_is_remote?: boolean
  job_posted_at_datetime_utc?: string | null
  job_city?: string | null
  job_state?: string | null
  job_country?: string | null
  job_min_salary?: number | null
  job_max_salary?: number | null
  job_salary_currency?: string | null
  job_salary_period?: string | null
}

// Buckets are all / today / 3days / week / month — no 14-day option, so we
// always filter by job_posted_at_datetime_utc ourselves.
//
// Measured 2026-09-12 on India queries: `week` returns a far fresher, denser
// slice than `month` (20 of 20 rows inside 14 days vs 8 of 20). So `week` is
// the default for any window up to a fortnight, and `month` is a retry rather
// than the first choice, even though it nominally covers more days.
export function bucketFor(days: number): string {
  if (days <= 1) return 'today'
  if (days <= 3) return '3days'
  if (days <= 14) return 'week'
  return 'month'
}

/** Naming the country inside the query text is what makes results both fresh
 *  and geographically spread. Without it the API pins to one metro and serves
 *  months-old rows (New Delhi only, 2 of 10 fresh). With it: 10 of 10. */
function countryName(code: string | null): string | null {
  if (!code) return null
  return COUNTRIES.find((c) => c.code === code.toUpperCase())?.name ?? null
}

function money(j: RawJob): string | null {
  const { job_min_salary: lo, job_max_salary: hi, job_salary_currency: cur, job_salary_period: per } = j
  if (!lo && !hi) return null
  const sym = cur === 'INR' ? '₹' : cur === 'USD' ? '$' : cur ? `${cur} ` : ''
  const fmt = (n: number) => (n >= 100000 ? `${Math.round(n / 100000)}L` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))
  const range = lo && hi ? `${fmt(lo)} to ${fmt(hi)}` : fmt((lo ?? hi) as number)
  const suffix = per && per !== 'YEAR' ? ` per ${per.toLowerCase()}` : ''
  return `${sym}${range}${suffix}`
}

function domainOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function toJob(j: RawJob): Job | null {
  if (!j.job_title || !j.employer_name) return null
  const city = [j.job_city, j.job_state].filter(Boolean).join(', ')
  const posted = j.job_posted_at_datetime_utc ? j.job_posted_at_datetime_utc.slice(0, 10) : ''
  return {
    id: String(j.job_id ?? `${j.employer_name}-${j.job_title}`),
    title: j.job_title,
    company: j.employer_name,
    company_domain: domainOf(j.employer_website),
    company_linkedin: null,
    location: city || j.job_country || '',
    remote: !!j.job_is_remote,
    salary: money(j),
    seniority: null,
    posted,
    url: j.job_apply_link ?? '',
    description: (j.job_description ?? '').slice(0, 4000),
    hiring_team: [],
  }
}

export const jsearchEnabled = () => JOBS_VIA_PROVIDER || !!JSEARCH_API_KEY

/** The provider's own parameters for one page. Same shape as the direct API. */
function providerParams(q: JSearchQuery): Record<string, unknown> {
  const name = countryName(q.countryCode)
  return {
    query: `${q.titles.slice(0, 3).join(' OR ')}${name ? ` in ${name}` : ''}`,
    page: q.page + 1,
    num_pages: 2,
    date_posted: q.bucket ?? bucketFor(q.days),
    ...(q.countryCode ? { country: q.countryCode.toLowerCase() } : {}),
    ...(q.remoteOnly ? { remote_jobs_only: true } : {}),
  }
}

/** One page of matching jobs, newest-first, already filtered to the window.
 *  Settles on the provider (1¢) when it carries the vendor; falls back to the
 *  direct key only while that path is unavailable. */
export async function searchJobs(q: JSearchQuery, account?: Account): Promise<{ ok: true; jobs: Job[] } | { ok: false; code: string; message: string }> {
  if (JOBS_VIA_PROVIDER && account) {
    const out = await runFor<{ data?: RawJob[] }>(account, 'openwebninja', 'jsearch', providerParams(q), 2)
    if (out.ok) return { ok: true, jobs: window(out.data.data ?? [], q.days) }
    if (!JSEARCH_API_KEY) return { ok: false, code: out.code, message: out.message }
    console.log('[jsearch] provider miss, direct fallback', JSON.stringify({ detail: out.detail ?? out.code }))
  }
  if (!JSEARCH_API_KEY) return { ok: false, code: 'not_configured', message: 'Job search is not configured.' }
  const name = countryName(q.countryCode)
  const url = new URL(ENDPOINT)
  url.searchParams.set('query', `${q.titles.slice(0, 3).join(' OR ')}${name ? ` in ${name}` : ''}`)
  url.searchParams.set('page', String(q.page + 1))
  url.searchParams.set('num_pages', '2')
  url.searchParams.set('date_posted', q.bucket ?? bucketFor(q.days))
  if (q.countryCode) url.searchParams.set('country', q.countryCode.toLowerCase())
  if (q.remoteOnly) url.searchParams.set('remote_jobs_only', 'true')

  let res: Response
  try {
    res = await fetch(url, { headers: { 'x-api-key': JSEARCH_API_KEY } })
  } catch (err) {
    console.error('[jsearch] network', err)
    return { ok: false, code: 'upstream', message: 'That step did not go through. Nothing was charged. Try again in a minute.' }
  }
  if (!res.ok) {
    console.error('[jsearch] http', res.status, (await res.text()).slice(0, 300))
    return { ok: false, code: 'upstream', message: 'That step did not go through. Nothing was charged. Try again in a minute.' }
  }
  const body = (await res.json().catch(() => ({}))) as { data?: RawJob[] }
  return { ok: true, jobs: window(body.data ?? [], q.days) }
}

/** Rows inside the window, newest first, one per posting, at most ten. */
function window(raw: RawJob[], days: number): Job[] {
  const cutoff = Date.now() - days * 86400000
  const jobs = raw
    .map(toJob)
    .filter((j): j is Job => !!j)
    .filter((j) => {
      // Undated rows are dropped: we promise a date window, so anything we
      // cannot date does not belong in it.
      if (!j.posted) return false
      const t = Date.parse(j.posted)
      return !Number.isNaN(t) && t >= cutoff
    })
  // Newest first, and never hand back two rows for the same posting.
  const seen = new Set<string>()
  const unique = jobs
    .sort((a, b) => (b.posted > a.posted ? 1 : b.posted < a.posted ? -1 : 0))
    .filter((j) => {
      const k = `${j.company.toLowerCase()}|${j.title.toLowerCase()}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  return unique.slice(0, 10)
}
