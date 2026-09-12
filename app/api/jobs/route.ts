import { bucketFor, jsearchEnabled, searchJobs } from '@/lib/jsearch'
import { runFor } from '@/lib/provider'
import type { Account } from '@/lib/ledger'
import { paidStep, readJson } from '@/lib/route'
import { saveItems } from '@/lib/saved'
import type { Job } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// ── legacy source (TheirStack, via the provider) ────────────────────────────
// Kept as the top-up and as the fallback without a JSEARCH_API_KEY. It bills a flat
// 40c per call regardless of rows, which is why it is no longer the default.
interface RawJob {
  id: number
  job_title: string
  company: string
  company_domain: string | null
  short_location?: string | null
  location?: string | null
  remote?: boolean | null
  salary_string?: string | null
  min_annual_salary_usd?: number | null
  max_annual_salary_usd?: number | null
  seniority?: string | null
  date_posted: string
  url: string
  final_url?: string | null
  description?: string | null
  hiring_team?: Array<Record<string, unknown>>
  company_object?: { linkedin_url?: string | null } | null
}

function salaryOf(j: RawJob): string | null {
  if (j.salary_string) return j.salary_string
  if (j.min_annual_salary_usd && j.max_annual_salary_usd)
    return `$${Math.round(j.min_annual_salary_usd / 1000)}k to $${Math.round(j.max_annual_salary_usd / 1000)}k`
  return null
}

function teamOf(raw: RawJob['hiring_team']): Job['hiring_team'] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((p) => {
      const name = String(p.full_name ?? p.name ?? [p.first_name, p.last_name].filter(Boolean).join(' ')).trim()
      if (!name) return null
      return { name, title: (p.title ?? p.role ?? null) as string | null, linkedin_url: (p.linkedin_url ?? p.url ?? null) as string | null }
    })
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, 3)
}

/** One TheirStack page. Flat fee per call regardless of rows, so always ask
 *  for the full 10 — a top-up of 3 rows costs exactly what 10 rows cost. */
async function legacySearch(
  account: Account,
  titles: string[],
  days: number,
  country: string | null,
  remote: boolean,
  page: number,
): Promise<Job[] | { error: string; message: string }> {
  const params: Record<string, unknown> = {
    job_title_or: titles,
    limit: 10,
    page,
    posted_at_max_age_days: days,
    ...(country ? { job_country_code_or: [country] } : {}),
    ...(remote ? { remote: true } : {}),
  }
  const out = await runFor<{ data?: RawJob[] }>(account, 'theirstack', 'jobs', params, 40)
  if (!out.ok) return { error: out.code, message: out.message }
  return (out.data.data ?? []).map((j) => ({
    id: String(j.id),
    title: j.job_title,
    company: j.company,
    company_domain: j.company_domain ?? null,
    company_linkedin: j.company_object?.linkedin_url ?? null,
    location: j.short_location ?? j.location ?? '',
    remote: !!j.remote,
    salary: salaryOf(j),
    seniority: j.seniority ?? null,
    posted: j.date_posted,
    url: j.final_url ?? j.url,
    description: (j.description ?? '').slice(0, 4000),
    hiring_team: teamOf(j.hiring_team),
  }))
}

/** Merge sources without showing the same posting twice. Google Jobs and
 *  TheirStack describe the same role differently, so match on company+title. */
function mergeJobs(...lists: Job[][]): Job[] {
  const seen = new Set<string>()
  const out: Job[] = []
  for (const list of lists) {
    for (const j of list) {
      const k = `${j.company.trim().toLowerCase()}|${j.title.trim().toLowerCase()}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(j)
    }
  }
  return out
}

/** Below this many fresh matches we top up from the pricier, deeper source. */
const THIN = 10

export async function POST(req: Request) {
  const body = await readJson<{ titles?: string[]; country_code?: string; remote?: boolean | null; days?: number; page?: number }>(req)
  const titles = (body.titles ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 5)
  if (titles.length === 0) return Response.json({ ok: false, code: 'invalid', message: 'Add at least one job title.' })
  const page = Math.min(20, Math.max(0, Math.floor(Number(body.page ?? 0))))
  const days = Math.min(60, Math.max(1, Number(body.days ?? 14)))
  const country = body.country_code && /^[A-Z]{2}$/i.test(body.country_code) ? body.country_code.toUpperCase() : null
  const remote = body.remote === true

  return paidStep<Job[]>(
    'jobs',
    async (account) => {
      const stats: Record<string, number> = {}
      let jobs: Job[] = []

      if (jsearchEnabled()) {
        // 1. The cheap source, at exactly the window the user asked for.
        const first = await searchJobs({ titles, countryCode: country, remoteOnly: remote, days, page })
        if (!first.ok) return { ok: false, code: first.code, message: first.message }
        stats.jsearch = first.jobs.length
        jobs = first.jobs

        // 2. Thin? Retry the cheap source on the wider bucket first. `week`
        //    is denser but nominally misses days 8-14, so this catches those
        //    before we spend anything.
        if (jobs.length < THIN && bucketFor(days) !== 'month') {
          const wider = await searchJobs({ titles, countryCode: country, remoteOnly: remote, days, page, bucket: 'month' })
          if (wider.ok && wider.jobs.length > 0) {
            stats.jsearch_month = wider.jobs.length
            jobs = mergeJobs(jobs, wider.jobs).slice(0, THIN)
          }
        }

        // 3. Still thin? Top up from the deeper source, still inside the
        //    user's window so everything we show stays fresh. This is the
        //    only path that costs real money, and only on a miss.
        if (jobs.length < THIN) {
          const topUp = await legacySearch(account, titles, days, country, remote, page)
          if (Array.isArray(topUp)) {
            stats.theirstack = topUp.length
            jobs = mergeJobs(jobs, topUp).slice(0, THIN)
          } else {
            // The fallback failing is not the user's problem when the cheap
            // source already found something.
            stats.theirstack = -1
            if (jobs.length === 0) return { ok: false, code: topUp.error, message: topUp.message }
          }
        }

        // 4. Nothing at all? Widen the cheap source before giving up.
        if (jobs.length === 0) {
          for (const t of [{ days: 30, country }, { days: 30, country: null }]) {
            if (t.days === days && t.country === country) continue
            const wide = await searchJobs({ titles, countryCode: t.country, remoteOnly: remote, days: t.days, page })
            if (!wide.ok) break
            if (wide.jobs.length > 0) {
              stats.jsearch_widened = wide.jobs.length
              jobs = wide.jobs
              break
            }
          }
        }
      } else {
        const out = await legacySearch(account, titles, days, country, remote, page)
        if (!Array.isArray(out)) return { ok: false, code: out.error, message: out.message }
        stats.theirstack_only = out.length
        jobs = out
      }

      // Per-source counts on every real query: this is the data for the
      // identical-query comparison once there is volume.
      console.log('[jobs]', JSON.stringify({ ...stats, merged: jobs.length, titles, days, country, remote, page }))

      if (jobs.length === 0) {
        return {
          ok: false,
          code: 'no_jobs',
          message:
            page > 0
              ? 'That is everything we could find for these titles. Nothing was charged.'
              : 'No postings matched those titles, even after widening the search. Nothing was charged. Try simpler titles, like "Product Manager" instead of a long one.',
        }
      }
      return { ok: true, data: jobs }
    },
    async (jobs, sub) =>
      saveItems(
        sub,
        jobs.map((j) => ({
          kind: 'job' as const,
          at: new Date().toISOString(),
          id: j.id,
          title: j.title,
          company: j.company,
          location: j.location,
          remote: j.remote,
          salary: j.salary,
          posted: j.posted,
          url: j.url,
        })),
      ),
  )
}
