import { run } from '@/lib/provider'
import { paidStep, readJson } from '@/lib/route'
import { saveItems } from '@/lib/saved'
import type { Job } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

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

export async function POST(req: Request) {
  const body = await readJson<{ titles?: string[]; country_code?: string; remote?: boolean | null; seniority?: string | null; days?: number; page?: number }>(req)
  const titles = (body.titles ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 5)
  if (titles.length === 0) return Response.json({ ok: false, code: 'invalid', message: 'Add at least one job title.' })
  const page = Math.min(20, Math.max(0, Math.floor(Number(body.page ?? 0))))
  const days = Math.min(60, Math.max(1, Number(body.days ?? 14)))
  const country = body.country_code && /^[A-Z]{2}$/i.test(body.country_code) ? body.country_code.toUpperCase() : null

  // Seniority is deliberately NOT sent: TheirStack's seniority labels are noisy
  // and combining them with exact titles was returning zero rows for perfectly
  // normal searches. The titles already carry the level ("Senior Backend …").
  const base: Record<string, unknown> = { job_title_or: titles, limit: 10, page }

  // Tier 1 is what the user asked for. If it comes back empty we widen once,
  // on our own cost — the user is only charged when rows actually come back.
  const tiers: Array<Record<string, unknown>> = [
    { ...base, posted_at_max_age_days: days, ...(country ? { job_country_code_or: [country] } : {}), ...(body.remote === true ? { remote: true } : {}) },
  ]
  const widened: Record<string, unknown> = { ...base, posted_at_max_age_days: Math.max(days, 30) }
  if (country) widened.job_country_code_or = [country]
  if (JSON.stringify(widened) !== JSON.stringify(tiers[0])) tiers.push(widened)
  if (country) tiers.push({ ...base, posted_at_max_age_days: Math.max(days, 30) })

  return paidStep<Job[]>(
    'jobs',
    async () => {
    for (let i = 0; i < tiers.length; i++) {
      const out = await run<{ data?: RawJob[] }>('theirstack', 'jobs', tiers[i], 40)
      if (!out.ok) return out
      const rows = out.data.data ?? []
      console.log('[jobs]', JSON.stringify({ tier: i, titles, days, country, remote: body.remote, page, rows: rows.length }))
      if (rows.length === 0) continue
      const jobs: Job[] = rows.map((j) => ({
        id: j.id,
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
      return { ok: true, data: jobs }
    }
      return {
      ok: false,
      code: 'no_jobs',
      message: page > 0
        ? 'That is everything we could find for these titles. Nothing was charged.'
        : 'No postings matched those titles, even after widening the search. Nothing was charged. Try simpler titles, like "Product Manager" instead of a long one.',
      }
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
