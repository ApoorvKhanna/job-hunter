// Resume text → a search profile. One cheap LLM call on the user's balance.
import { extractJson, readJson, withVaaya } from '@/lib/route'
import type { Profile } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60


const SYSTEM = `You turn a resume into a job-search profile. Reply with ONLY a JSON object, no prose, shaped exactly:
{"headline": string (one line, who this person is),
 "titles": string[] (3 to 5 job titles to search postings for, phrased the way employers post them, most likely first),
 "seniority": "junior" | "mid_level" | "senior" | "staff" | "c_level" | null,
 "country_code": string (ISO 3166 two-letter code of where they live or want to work; "US" if unclear),
 "remote": boolean | null (true only if the resume signals remote preference),
 "technologies": string[] (up to 8 concrete tools, languages or platforms),
 "years": number | null (years of relevant experience)}`

export async function POST(req: Request) {
  const { resume } = await readJson<{ resume?: string }>(req)
  const text = (resume ?? '').trim().slice(0, 12_000)
  if (text.length < 80) {
    return Response.json({ ok: false, code: 'invalid_params', message: 'Paste at least a few lines of your resume.' })
  }
  return withVaaya<Profile>(async (v) => {
    const out = await v.chat(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Resume:\n\n${text}` },
      ],
      600,
    )
    if (!out.ok) return out
    const profile = extractJson<Profile>(out.data)
    if (!profile || !Array.isArray(profile.titles) || profile.titles.length === 0) {
      return { ok: false, status: 200, code: 'parse_failed', message: 'Could not read that resume. Try pasting plain text.' }
    }
    return {
      ok: true,
      data: {
        headline: String(profile.headline ?? ''),
        titles: profile.titles.slice(0, 5).map(String),
        seniority: profile.seniority ?? null,
        country_code: (profile.country_code || 'US').toUpperCase().slice(0, 2),
        remote: typeof profile.remote === 'boolean' ? profile.remote : null,
        technologies: (profile.technologies ?? []).slice(0, 8).map(String),
        years: typeof profile.years === 'number' ? profile.years : null,
      },
      chargedCents: out.chargedCents,
      balanceCents: out.balanceCents,
    }
  })
}
