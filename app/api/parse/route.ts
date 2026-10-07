// Read a resume into a search profile. Free to the user, capped per account
// per day (PARSES_PER_DAY) because each read is a model call on the
// operator's key.
import { NextResponse } from 'next/server'
import { takeParse } from '@/lib/ledger'
import { MAX_SEARCH_TITLES } from '@/lib/prices'
import { chat } from '@/lib/provider'
import { caller, extractJson, readJson } from '@/lib/route'
import type { Profile } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = `You turn a resume into a job-search profile. Reply with ONLY a JSON object, no prose, shaped exactly:
{"headline": string (one line, who this person is),
 "titles": string[] (2 to 3 job titles to search postings for, phrased the way employers post them, most likely first),
 "country_code": string (ISO 3166 two-letter code of where they live or want to work; "US" if unclear),
 "remote": boolean | null (true only if the resume signals remote preference),
 "years": number | null (years of relevant experience)}`

export async function POST(req: Request) {
  const { resume } = await readJson<{ resume?: string }>(req)
  const text = (resume ?? '').trim().slice(0, 12_000)
  if (text.length < 80) return NextResponse.json({ ok: false, code: 'invalid', message: 'Paste at least a few lines of your resume' })
  const who = await caller()
  if ('response' in who) return who.response
  if (!(await takeParse(who.session.sub))) {
    return NextResponse.json({ ok: false, code: 'limit', message: 'You have read a lot of resumes today. Try again tomorrow' })
  }
  const out = await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: `Resume:\n\n${text}` }], 600)
  if (!out.ok) return NextResponse.json(out)
  const p = extractJson<Profile>(out.data)
  if (!p || !Array.isArray(p.titles) || p.titles.length === 0) {
    return NextResponse.json({ ok: false, code: 'parse_failed', message: 'Could not read that resume. Try pasting plain text' })
  }
  const data: Profile = {
    headline: String(p.headline ?? ''),
    titles: p.titles.slice(0, MAX_SEARCH_TITLES).map(String),
    country_code: (p.country_code || 'US').toUpperCase().slice(0, 2),
    remote: typeof p.remote === 'boolean' ? p.remote : null,
    years: typeof p.years === 'number' ? p.years : null,
  }
  return NextResponse.json({ ok: true, data })
}
