import { chat } from '@/lib/provider'
import { paidStep, readJson } from '@/lib/route'
import { saveItems, splitNote } from '@/lib/saved'
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
- Output only the subject line and the note. No preamble, no notes to the reader.`


export async function POST(req: Request) {
  const body = await readJson<{
    resume?: string
    job?: { title: string; company: string; description: string; url: string }
    person?: { name: string; title: string }
    to?: string | null
    variant?: Variant
    previous?: string
  }>(req)
  const resume = body.resume
  const job = body.job
  if (!resume || !job) return Response.json({ ok: false, code: 'invalid', message: 'Resume and job are required.' })
  const variant = body.variant && body.variant in VARIANTS ? body.variant : null
  if (variant && !body.previous) {
    return Response.json({ ok: false, code: 'invalid', message: 'Nothing to rewrite yet.' })
  }
  const who = body.person?.name ? `${body.person.name} (${body.person.title})` : 'the hiring manager'

  return paidStep<string>(
    'draft',
    async () => {
      const system = variant ? `${BASE}\n\nYou are rewriting a note you already wrote. ${VARIANTS[variant]}` : BASE
      const user = variant
        ? `Write to: ${who} at ${job.company}\nRole: ${job.title}\n\nYour previous note:\n${body.previous}\n\nYour resume:\n${resume.slice(0, 6000)}`
        : `Write to: ${who} at ${job.company}\nRole: ${job.title}\nPosting URL: ${job.url}\n\nPosting:\n${job.description.slice(0, 3500)}\n\nYour resume:\n${resume.slice(0, 8000)}`
      const out = await chat([{ role: 'system', content: system }, { role: 'user', content: user }], 450)
      if (!out.ok) return out
      return { ok: true, data: out.data.trim() }
    },
    async (note, sub) => {
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
          person: body.person?.name ?? null,
          to: body.to ?? null,
        },
      ])
    },
  )
}
