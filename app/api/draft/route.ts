// Draft (or rewrite) the email for a job in the run, optionally to one of
// its contacts. Each draft or rewrite uses one of the run's drafts.
import { chat } from '@/lib/provider'
import { caller, readJson, runStepResponse } from '@/lib/route'
import { linkedinKey } from '@/lib/runs'
import { saveItems, splitNote } from '@/lib/saved'
import type { Job, Person } from '@/lib/types'
import { VARIANTS, type Variant } from '@/lib/variants'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BASE = `You ARE the candidate whose resume is given. Write the note as yourself, to the person named. Rules:
- First person throughout ("I built", "my team"). Never write about the candidate in the third person, and never refer to "the candidate" or "this person".
- First line is "Subject: ..." (under 8 words). Then a blank line, then the note.
- 90 to 130 words. Plain text. No bullet points, no em-dashes, no exclamation marks.
- Open with one concrete thing from the posting that you have actually done, taken from your resume. Never invent experience you do not have.
- Second paragraph: one or two proof points with numbers from your resume where they exist.
- Close with a five-word ask for a 15-minute call, then sign off with your first name from the resume on its own line.
- Address the person by their first name. Do not mention how you found their email.
- Write in plain American English.
- Output only the subject line and the note. No preamble, no notes to the reader.`

export async function POST(req: Request) {
  const body = await readJson<{
    run_id?: string
    job_id?: string
    linkedin_url?: string | null
    resume?: string
    variant?: Variant
    previous?: string
  }>(req)
  const resume = body.resume?.trim()
  if (!body.run_id || !body.job_id || !resume) {
    return Response.json({ ok: false, code: 'invalid', message: 'Pick a job from your search and add your resume' })
  }
  const variant = body.variant && body.variant in VARIANTS ? body.variant : null
  if (variant && !body.previous) return Response.json({ ok: false, code: 'invalid', message: 'Nothing to rewrite yet' })
  const who = await caller()
  if ('response' in who) return who.response

  const personKey = body.linkedin_url ? linkedinKey(body.linkedin_url) : null
  let job: Job | undefined
  let person: Person | undefined
  let to: string | null = null

  return runStepResponse<string>(
    {
      runId: body.run_id,
      kind: 'drafts',
      check: (r) => {
        job = r.jobs.find((j) => j.id === body.job_id)
        if (!job) return 'That job is not part of this search'
        if (personKey) {
          person = Object.values(r.contacts).flat().find((p) => linkedinKey(p.linkedin_url) === personKey)
          if (!person) return 'That person is not one of this search’s contacts'
          const e = r.emails[personKey]
          to = e ? ([...e.work, ...e.personal][0] ?? null) : null
        }
        return null
      },
      work: async () => {
        if (!job) return null
        const whom = person ? `${person.name} (${person.title})` : 'the hiring manager'
        const system = variant ? `${BASE}\n\nYou are rewriting a note you already wrote. ${VARIANTS[variant]}` : BASE
        const user = variant
          ? `Write to: ${whom} at ${job.company}\nRole: ${job.title}\n\nYour previous note:\n${body.previous}\n\nYour resume:\n${resume.slice(0, 6000)}`
          : `Write to: ${whom} at ${job.company}\nRole: ${job.title}\nPosting URL: ${job.url}\n\nPosting:\n${job.description.slice(0, 3500)}\n\nYour resume:\n${resume.slice(0, 8000)}`
        const out = await chat([{ role: 'system', content: system }, { role: 'user', content: user }], 450)
        if (!out.ok) throw new Error(out.detail ?? out.code)
        return out.data.trim() || null
      },
      miss: 'The draft came back empty. This attempt did not use your run. Try again',
    },
    async (note, sub) => {
      if (!job) return
      const { subject, body: text } = splitNote(note)
      await saveItems(sub, [
        {
          kind: 'note',
          at: new Date().toISOString(),
          subject,
          body: text,
          company: job.company,
          jobTitle: job.title,
          jobUrl: job.url,
          person: person?.name ?? null,
          to,
        },
      ])
    },
  )
}
