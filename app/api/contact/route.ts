// Who to write to at the company. Three rungs, cheapest first; the user is
// charged ₹3 only if at least one person comes back.
//   1. routed people-finder (2¢): "managers, founders, recruiters at X" → up to 15 rows
//   2. ContactOut people search, broad leadership titles (3¢)
//   3. nothing → no_people, no charge
import { run } from '@/lib/provider'
import { paidStep, readJson } from '@/lib/route'
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

async function rungFind(company: string, domain: string | null, jobTitle: string): Promise<Person[]> {
  const fn = functionWord(jobTitle)
  const q = `${fn} managers, heads of ${fn}, founders or technical recruiters at ${company}${domain ? ` (${domain})` : ''}`
  const out = await run<{ rows?: FindRow[] }>('vaaya', 'onefind', { query: q }, 2)
  if (!out.ok) return []
  return (out.data.rows ?? [])
    .filter((r) => r.name && r.linkedin && /linkedin\.com\/in\//i.test(r.linkedin) && sameCompany(r.company, company))
    .map((r) => ({
      name: String(r.name),
      title: String(r.title ?? ''),
      headline: null,
      location: r.location ?? null,
      linkedin_url: String(r.linkedin),
      has_work_email: true, // unknown until we ask; a miss is never charged
      has_personal_email: false,
    }))
}

async function rungContactOut(company: string, jobTitle: string): Promise<Person[]> {
  const fn = functionWord(jobTitle)
  const titles = `Founder OR CEO OR CTO OR Co-Founder OR Head OR Director OR VP OR Manager OR Recruiter OR Talent OR HR OR ${fn}`
  const out = await run<{ profiles?: Record<string, Record<string, unknown>> }>(
    'contactout',
    'people-search',
    { job_title: [titles], company: [company], current_titles_only: true, company_filter: 'current', page_size: 5 },
    5,
  )
  if (!out.ok) return []
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
  const { company, company_domain, job_title } = await readJson<{ company?: string; company_domain?: string | null; job_title?: string }>(req)
  if (!company) return Response.json({ ok: false, code: 'invalid', message: 'Company is required.' })
  const title = job_title ?? ''
  return paidStep<Person[]>('contact', async () => {
    const seen = new Set<string>()
    const people: Person[] = []
    const add = (rows: Person[]) => {
      for (const p of rows) {
        const k = p.linkedin_url.toLowerCase().replace(/\/+$/, '')
        if (!seen.has(k)) {
          seen.add(k)
          people.push(p)
        }
      }
    }
    const t0 = Date.now()
    add(await rungFind(company, company_domain ?? null, title))
    const t1 = Date.now()
    if (people.length < 2) add(await rungContactOut(company, title))
    console.log('[contact]', JSON.stringify({ company, title, find_ms: t1 - t0, contactout_ms: people.length < 2 ? Date.now() - t1 : 0, people: people.length }))
    if (people.length === 0) {
      console.log('[contact] no people', company, company_domain)
      return { ok: false, code: 'no_people', message: `Could not find anyone at ${company} yet. Nothing was charged. Try another posting, or draft a note without a name.` }
    }
    const fn = functionWord(title)
    people.sort((a, b) => rank(b, fn) - rank(a, fn))
    return { ok: true, data: people.slice(0, 5) }
  })
}
