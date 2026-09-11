// Turn an uploaded PDF, DOCX or text file into plain text. Free.
import { NextResponse } from 'next/server'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 6 * 1024 * 1024

export async function POST(req: Request) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ ok: false, code: 'invalid', message: 'Choose a file.' })
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, code: 'too_large', message: 'Files up to 6 MB.' })
  const name = file.name.toLowerCase()
  const buf = Buffer.from(await file.arrayBuffer())
  try {
    let text = ''
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(buf))
      const out = await extractText(pdf, { mergePages: true })
      text = out.text
    } else if (name.endsWith('.docx')) {
      const mammoth = await import('mammoth')
      text = (await mammoth.extractRawText({ buffer: buf })).value
    } else if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
      text = buf.toString('utf8')
    } else if (name.endsWith('.doc')) {
      return NextResponse.json({ ok: false, code: 'unsupported', message: 'Old .doc files are not supported. Save as PDF or DOCX.' })
    } else {
      return NextResponse.json({ ok: false, code: 'unsupported', message: 'PDF, DOCX or TXT please.' })
    }
    text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (text.length < 80) return NextResponse.json({ ok: false, code: 'empty', message: 'Could not read text from that file. If it is a scan, paste the text instead.' })
    return NextResponse.json({ ok: true, data: { text: text.slice(0, 20_000) } })
  } catch (err) {
    console.error('[extract]', err)
    return NextResponse.json({ ok: false, code: 'failed', message: 'Could not read that file. Paste the text instead.' })
  }
}
