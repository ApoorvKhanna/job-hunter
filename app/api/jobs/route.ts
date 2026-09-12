import { jsearchEnabled, searchJobs } from '@/lib/jsearch'
import { run } from '@/lib/provider'
import { paidStep, readJson } from '@/lib/route'
import { saveItems } from '@/lib/saved'
import type { Job } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// ── legacy source (TheirStack, via the provider) ────────────────────────────
// Kept as the fallback for deployments without a RAPIDAPI_KEY. It bills a flat
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

async function legacySearch(titles: string[], days: number, country: string | null, remote: boolean, page: number): Promise<Job[] | { error: string; message: string }> {
  const base: Record<string, unknown> = { job_title_or: titles, limit: 10, page }
  const tiers: Array<Record<string, unknown>> = [
    { ...base, posted_at_max_age_days: days, ...(country ? { job_country_code_or: [country] } : {}), ...(remote ? { remote: true } : {}) },
  ]
  const widened: Record<string, unknown> = { ...base, posted_at_max_age_days: Math.max(days, 30) }
  if (country) widened.job_country_code_or = [country]
  if (JSON.stringify(widened) !== JSON.stringify(tiers[0])) tiers.push(widened)
  if (country) tiers.push({ ...base, posted_at_max_age_days: Math.max(days, 30) })

  for (const params of tiers) {
    const out = await run<{ data?: RawJob[] }>('theirstack', 'jobs', params, 40)
    if (!out.ok) return { error: out.code, message: out.message }
    const rows = out.data.data ?? []
    if (rows.length === 0) continue
    return rows.map((j) => ({
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
  return []
}

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
    async () => {
      let jobs: Job[] = []
      if (jsearchEnabled()) {
        // Tier 1 is what the user asked for. Empty? widen the window and drop
        // the country once, on our own cost — they are only charged for rows.
        const tiers: Array<{ days: number; country: string | null }> = [{ days, country }]
        if (days < 30) tiers.push({ days: 30, country })
        if (country) tiers.push({ days: Math.max(days, 30), country: null })
        for (let i = 0; i < tiers.length; i++) {
          const t = tiers[i]
          const out = await searchJobs({ titles, countryCode: t.country, remoteOnly: remote, days: t.days, page })
          if (!out.ok) return { ok: false, code: out.code, message: out.message }
          console.log('[jobs] jsearch', JSON.stringify({ tier: i, titles, ...t, remote, page, rows: out.jobs.length }))
          if (out.jobs.length > 0) {
            jobs = out.jobs
            break
          }
        }
      } else {
        const out = await legacySearch(titles, days, country, remote, page)
        if (!Array.isArray(out)) return { ok: false, code: out.error, message: out.message }
        console.log('[jobs] legacy', JSON.stringify({ titles, days, country, remote, page, rows: out.length }))
        jobs = out
      }

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
