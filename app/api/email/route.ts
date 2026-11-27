// The work email behind a LinkedIn profile. Two rungs on the provider's
// catalog; the user is charged only when an address comes back.
//   1. QuickEnrich (about 0.5¢ a hit, ~75 ms). Found 2 of 3 Indian profiles
//      in a 2026-11-24 spot check where BlitzAPI found none.
//   2. BlitzAPI (about 0.1¢ a hit), only when the first rung misses. The best
//      find rate across all of treg's traffic, weaker on Indian profiles.
// Both bill nothing upstream on a miss. ContactOut (10¢) was dropped: its
// live API access lapsed and it only came back through sales.
import type { Account } from '@/lib/ledger'
import { runFor } from '@/lib/provider'
import { paidStep, readJson } from '@/lib/route'
import { saveItems } from '@/lib/saved'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Valid-looking, lowercased, unique. Vendors send "N/A" or null on a miss. */
function clean(list: unknown[]): string[] {
  const out: string[] = []
  for (const v of list) {
    const e = typeof v === 'string' ? v.trim().toLowerCase() : ''
    if (EMAIL.test(e) && !out.includes(e)) out.push(e)
  }
  return out
}

type Rung = { ok: true; emails: string[] } | { ok: false; code: string; message: string }

async function blitz(account: Account, url: string): Promise<Rung> {
  const out = await runFor<{ data?: { found?: boolean; email?: string | null; all_emails?: Array<{ email?: string | null }> } }>(
    account, 'treg', 'submit', { endpoint: 'blitzapi.people.email.find', person_linkedin_url: url }, 2,
  )
  if (!out.ok) return out
  const d = out.data.data
  return { ok: true, emails: clean([d?.email, ...(d?.all_emails ?? []).map((e) => e.email)]) }
}

async function quickEnrich(account: Account, url: string): Promise<Rung> {
  const out = await runFor<{ data?: { data?: { email?: string | null } } }>(
    account, 'treg', 'fetch', { endpoint: 'quickenrich.people.email.find', linkedin_url: url }, 2,
  )
  if (!out.ok) return out
  return { ok: true, emails: clean([out.data.data?.data?.email]) }
}

export async function POST(req: Request) {
  const { linkedin_url, name, title, company } = await readJson<{
    linkedin_url?: string
    name?: string
    title?: string
    company?: string
  }>(req)
  if (!linkedin_url || !/linkedin\.com\/in\//i.test(linkedin_url)) {
    return Response.json({ ok: false, code: 'invalid', message: 'A LinkedIn profile is required.' })
  }
  return paidStep<{ work: string[]; personal: string[] }>(
    'email',
    async (account) => {
      const t0 = Date.now()
      const first = await quickEnrich(account, linkedin_url)
      let work = first.ok ? first.emails : []
      let second: Rung | null = null
      if (work.length === 0) {
        second = await blitz(account, linkedin_url)
        if (second.ok) work = second.emails
      }
      console.log('[email]', JSON.stringify({
        quickenrich: first.ok ? first.emails.length : first.code,
        blitz: second ? (second.ok ? second.emails.length : second.code) : 'skipped',
        found: work.length,
        ms: Date.now() - t0,
      }))
      if (work.length > 0) return { ok: true, data: { work, personal: [] } }
      // Both rungs broke (not a miss): say so, so the user retries instead of
      // giving up on a person we might well have.
      if (!first.ok && second && !second.ok) return second
      return { ok: false, code: 'no_email', message: 'No email on file for this person. Your email credit was not used.' }
    },
    async (data, sub) =>
      saveItems(sub, [
        {
          kind: 'email',
          at: new Date().toISOString(),
          name: name ?? '',
          title: title ?? '',
          company: company ?? '',
          linkedin_url,
          emails: data.work,
        },
      ]),
  )
}
