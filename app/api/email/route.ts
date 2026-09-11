// Reveal one person's email from their LinkedIn URL. 10¢, billed only on a hit.
import { EMAIL_PRICE_CENTS } from '@/lib/prices'
import { readJson, withVaaya } from '@/lib/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const { linkedin_url } = await readJson<{ linkedin_url?: string }>(req)
  if (!linkedin_url || !/linkedin\.com\/in\//i.test(linkedin_url)) {
    return Response.json({ ok: false, code: 'invalid_params', message: 'A linkedin.com/in/ URL is required.' })
  }
  return withVaaya<{ work: string[]; personal: string[] }>(async (v) => {
    const out = await v.run<{ profile?: { email?: string[]; work_email?: string[]; personal_email?: string[] } }>(
      'contactout',
      'linkedin-contacts',
      { profile: linkedin_url, include_phone: false },
      EMAIL_PRICE_CENTS,
    )
    if (!out.ok) return out
    const p = out.data.profile ?? {}
    const work = p.work_email ?? []
    const personal = p.personal_email ?? []
    const all = p.email ?? []
    return {
      ok: true,
      data: {
        work: work.length ? work : all.filter((e) => !personal.includes(e)),
        personal,
      },
      chargedCents: out.chargedCents,
      balanceCents: out.balanceCents,
    }
  })
}
