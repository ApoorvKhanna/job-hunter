// Matching postings from TheirStack. Flat 40¢ for up to 10 jobs.
import { JOBS_PRICE_CENTS } from '@/lib/prices'
import { readJson, withVaaya } from '@/lib/route'
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
      const name = String(p.full_name ?? p.name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? '').trim()
      if (!name) return null
      return {
        name,
        title: (p.title ?? p.role ?? null) as string | null,
        linkedin_url: (p.linkedin_url ?? p.url ?? null) as string | null,
      }
    })
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, 3)
}

export async function POST(req: Request) {
  const body = await readJson<{
    titles?: string[]
    country_code?: string
    remote?: boolean | null
    seniority?: string | null
    days?: number
  }>(req)
  const titles = (body.titles ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 5)
  if (titles.length === 0) return Response.json({ ok: false, code: 'invalid_params', message: 'Add at least one job title.' })
  const params: Record<string, unknown> = {
    job_title_or: titles,
    posted_at_max_age_days: Math.min(60, Math.max(1, Number(body.days ?? 14))),
    limit: 10,
  }
  if (body.country_code && /^[A-Z]{2}$/i.test(body.country_code)) params.job_country_code_or = [body.country_code.toUpperCase()]
  if (body.remote === true) params.remote = true
  if (body.seniority) params.job_seniority_or = [body.seniority]

  return withVaaya<Job[]>(async (v) => {
    const out = await v.run<{ data?: RawJob[] }>('theirstack', 'jobs', params, JOBS_PRICE_CENTS)
    if (!out.ok) return out
    const jobs: Job[] = (out.data.data ?? []).map((j) => ({
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
    return { ok: true, data: jobs, chargedCents: out.chargedCents, balanceCents: out.balanceCents }
  })
}
