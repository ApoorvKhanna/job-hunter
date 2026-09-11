import { run } from '@/lib/provider'
import { paidStep, readJson } from '@/lib/route'
import type { Person } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function titleQuery(jobTitle: string): string {
  const eng = /engineer|developer|sre|devops|data|ml|machine learning|scientist|architect/i.test(jobTitle)
  const design = /design/i.test(jobTitle)
  const product = /product manager|product lead|\bpm\b/i.test(jobTitle)
  if (design) return 'Head of Design OR Design Manager OR Design Recruiter OR Talent Acquisition'
  if (product) return 'Head of Product OR VP Product OR Product Recruiter OR Talent Acquisition'
  if (eng) return 'Engineering Manager OR Head of Engineering OR VP Engineering OR Technical Recruiter OR Talent Acquisition'
  return 'Hiring Manager OR Head of Talent OR Recruiter OR Talent Acquisition'
}

export async function POST(req: Request) {
  const { company, job_title } = await readJson<{ company?: string; job_title?: string }>(req)
  if (!company) return Response.json({ ok: false, code: 'invalid', message: 'Company is required.' })
  return paidStep<Person[]>('contact', async () => {
    const out = await run<{ profiles?: Record<string, Record<string, unknown>> }>(
      'contactout',
      'people-search',
      { job_title: [titleQuery(job_title ?? '')], company: [company], current_titles_only: true, company_filter: 'current', page_size: 3 },
      3,
    )
    if (!out.ok) return out
    const people: Person[] = Object.entries(out.data.profiles ?? {}).map(([url, p]) => {
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
    return { ok: true, data: people }
  })
}
