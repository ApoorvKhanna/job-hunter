// JSearch (OpenWeb Ninja), the job source. Google Jobs under the hood, so it
// sees company career pages, LinkedIn, Indeed and the rest. Salary comes
// through when the publisher states it.
//
// Two ways in. With JSEARCH_API_KEY set, calls go to OpenWeb Ninja's direct
// API on that key. Without it, they go through Vaaya (openwebninja/jsearch)
// on VAAYA_API_KEY. Same parameters, same response shape.
import { COUNTRIES } from './countries'
import { JSEARCH_API_KEY } from './env'
import type { Account } from './ledger'
import { MAX_JOBS, MAX_SEARCH_TITLES } from './prices'
import { runFor } from './provider'
import type { Job } from './types'

const ENDPOINT = 'https://api.openwebninja.com/jsearch/search'

export interface JSearchQuery {
  titles: string[]
  countryCode: string | null
  remoteOnly: boolean
  days: number
  page: number
  /** Override the date bucket; the jobs route uses this to retry wider. */
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

// Buckets are all / today / 3days / week / month. There is no 14-day option,
// so we always filter by job_posted_at_datetime_utc ourselves.
//
// Measured on live queries: `week` returns a far fresher, denser slice than
// `month` (20 of 20 rows inside 14 days vs 8 of 20). So `week` is the default
// for any window up to a fortnight, and `month` is a retry rather than the
// first choice, even though it nominally covers more days.
export function bucketFor(days: number): string {
  if (days <= 1) return 'today'
  if (days <= 3) return '3days'
  if (days <= 14) return 'week'
  return 'month'
}

/** Naming the country inside the query text is what makes results both fresh
 *  and geographically spread. Without it the API tends to pin to one metro and
 *  serve months-old rows. */
function countryName(code: string | null): string | null {
  if (!code) return null
  return COUNTRIES.find((c) => c.code === code.toUpperCase())?.name ?? null
}

function money(j: RawJob): string | null {
  const { job_min_salary: lo, job_max_salary: hi, job_salary_currency: cur, job_salary_period: per } = j
  if (!lo && !hi) return null
  const sym = !cur || cur === 'USD' ? '$' : `${cur} `
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))
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

function params(q: JSearchQuery): Record<string, string | number | boolean> {
  const name = countryName(q.countryCode)
  return {
    query: `${q.titles.slice(0, MAX_SEARCH_TITLES).join(' OR ')}${name ? ` in ${name}` : ''}`,
    page: q.page + 1,
    num_pages: 2,
    date_posted: q.bucket ?? bucketFor(q.days),
    ...(q.countryCode ? { country: q.countryCode.toLowerCase() } : {}),
    ...(q.remoteOnly ? { remote_jobs_only: true } : {}),
  }
}

const FAILED = { ok: false as const, code: 'upstream', message: 'Job search did not go through. Nothing was charged. Try again in a minute' }

/** One page of matching jobs, newest first, already filtered to the window. */
export async function searchJobs(q: JSearchQuery, account: Account): Promise<{ ok: true; jobs: Job[] } | { ok: false; code: string; message: string }> {
  if (!JSEARCH_API_KEY) {
    const out = await runFor<{ data?: RawJob[] }>(account, 'openwebninja', 'jsearch', params(q), 2)
    if (!out.ok) return { ok: false, code: out.code, message: out.message }
    return { ok: true, jobs: window(out.data.data ?? [], q.days) }
  }
  const url = new URL(ENDPOINT)
  for (const [k, v] of Object.entries(params(q))) url.searchParams.set(k, String(v))
  let res: Response
  try {
    res = await fetch(url, { headers: { 'x-api-key': JSEARCH_API_KEY } })
  } catch (err) {
    console.error('[jsearch] network', err)
    return FAILED
  }
  if (!res.ok) {
    console.error('[jsearch] http', res.status, (await res.text()).slice(0, 300))
    return FAILED
  }
  const body = (await res.json().catch(() => ({}))) as { data?: RawJob[] }
  return { ok: true, jobs: window(body.data ?? [], q.days) }
}

/** Rows inside the window, newest first, one per posting, at most MAX_JOBS. */
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
  return unique.slice(0, MAX_JOBS)
}
