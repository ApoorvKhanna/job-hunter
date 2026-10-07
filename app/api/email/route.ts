// Look up the email for one of the run's contacts. A person with no email on
// file does not use up the run's email allowance; a person already looked up
// comes back free.
import { companyKey, linkedinKey } from '@/lib/format'
import { runFor } from '@/lib/provider'
import { caller, readJson, runStepResponse } from '@/lib/route'
import type { Emails } from '@/lib/runs'
import { saveItems } from '@/lib/saved'
import type { Person } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const { run_id, linkedin_url } = await readJson<{ run_id?: string; linkedin_url?: string }>(req)
  if (!run_id || !linkedin_url || !/linkedin\.com\/in\//i.test(linkedin_url)) {
    return Response.json({ ok: false, code: 'invalid', message: 'Pick a contact from your search' })
  }
  const who = await caller()
  if ('response' in who) return who.response
  const account = who.account
  const key = linkedinKey(linkedin_url)
  let found: { person: Person; company: string } | null = null

  return runStepResponse<Emails>(
    {
      runId: run_id,
      kind: 'emails',
      check: (r) => {
        for (const [company, people] of Object.entries(r.contacts)) {
          const person = people.find((p) => linkedinKey(p.linkedin_url) === key)
          if (person) {
            found = { person, company: r.jobs.find((j) => companyKey(j.company) === company)?.company ?? '' }
            return null
          }
        }
        return 'That person is not one of this search’s contacts'
      },
      cached: (r) => r.emails[key],
      key: () => key,
      work: async () => {
        const out = await runFor<{ profile?: { email?: string[]; work_email?: string[]; personal_email?: string[] } }>(
          account,
          'contactout',
          'linkedin-contacts',
          { profile: linkedin_url, include_phone: false },
          10,
        )
        if (!out.ok) throw new Error(out.detail ?? out.code)
        const p = out.data.profile ?? {}
        const personal = p.personal_email ?? []
        const work = (p.work_email ?? []).length ? (p.work_email as string[]) : (p.email ?? []).filter((e) => !personal.includes(e))
        return work.length + personal.length ? { work, personal } : null
      },
      save: (r, emails) => {
        r.emails[key] = emails
      },
      miss: 'No email on file for this person. This lookup did not use your run',
    },
    async (data, sub) => {
      const f = found as { person: Person; company: string } | null
      await saveItems(sub, [
        {
          kind: 'email',
          at: new Date().toISOString(),
          name: f?.person.name ?? '',
          title: f?.person.title ?? '',
          company: f?.company ?? '',
          linkedin_url,
          emails: [...data.work, ...data.personal],
        },
      ])
    },
  )
}
