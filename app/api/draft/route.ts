import { chat } from '@/lib/provider'
import { paidStep, readJson } from '@/lib/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = `You write short, specific outreach notes for job seekers. Rules:
- First line is "Subject: ..." (under 8 words). Then a blank line, then the note.
- 90 to 130 words. Plain text. No bullet points, no em-dashes, no exclamation marks.
- Open with one concrete thing from the posting that the candidate has actually done (from the resume). Never invent experience.
- Second paragraph: one or two proof points with numbers from the resume where they exist.
- Close with a five-word ask for a 15-minute call. Sign with the candidate's first name.
- Address the person by first name. Do not mention how you found their email.`

export async function POST(req: Request) {
  const body = await readJson<{ resume?: string; job?: { title: string; company: string; description: string; url: string }; person?: { name: string; title: string } }>(req)
  const resume = body.resume
  const job = body.job
  if (!resume || !job) return Response.json({ ok: false, code: 'invalid', message: 'Resume and job are required.' })
  const who = body.person?.name ? `${body.person.name} (${body.person.title})` : 'the hiring manager'
  return paidStep<string>('draft', async () => {
    const out = await chat(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Write to: ${who} at ${job.company}\nRole: ${job.title}\nPosting URL: ${job.url}\n\nPosting:\n${job.description.slice(0, 3500)}\n\nCandidate resume:\n${resume.slice(0, 8000)}` },
      ],
      450,
    )
    if (!out.ok) return out
    return { ok: true, data: out.data.trim() }
  })
}
