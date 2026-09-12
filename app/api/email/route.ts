import { run } from '@/lib/provider'
import { paidStep, readJson } from '@/lib/route'
import { saveItems } from '@/lib/saved'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
    async () => {
      const out = await run<{ profile?: { email?: string[]; work_email?: string[]; personal_email?: string[] } }>(
        'contactout',
        'linkedin-contacts',
        { profile: linkedin_url, include_phone: false },
        10,
      )
      if (!out.ok) return out
      const p = out.data.profile ?? {}
      const personal = p.personal_email ?? []
      const work = (p.work_email ?? []).length
        ? (p.work_email as string[])
        : (p.email ?? []).filter((e) => !personal.includes(e))
      if (work.length + personal.length === 0) {
        return { ok: false, code: 'no_email', message: 'No email on file for this person. Nothing was charged.' }
      }
      return { ok: true, data: { work, personal } }
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
          emails: [...data.work, ...data.personal],
        },
      ]),
  )
}
