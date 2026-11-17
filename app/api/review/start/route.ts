// Save what the review needs (resume text, page layout and images, links,
// target roles) as a draft. Nothing is charged here; /api/review/run charges
// and starts it, after a top-up if the balance is short.
import { NextResponse } from 'next/server'
import { isBlocked } from '@/lib/blocks'
import { type PageInput, type RawItem, toBlocks } from '@/lib/layout'
import { ensureAccount } from '@/lib/ledger'
import { normalizeLinks } from '@/lib/links'
import { type Review, createReview, savePageImage } from '@/lib/review-store'
import { readJson } from '@/lib/route'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_IMAGE_BYTES = 1_800_000
const MAX_VISION_BYTES = 260_000

function jpeg(dataUrl: unknown, max = MAX_IMAGE_BYTES): Buffer | null {
  if (typeof dataUrl !== 'string') return null
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length < 1000 || buf.length > max || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  return buf
}

function items(raw: unknown): RawItem[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 4000).flatMap((i) => {
    if (!i || typeof i !== 'object') return []
    const o = i as Record<string, unknown>
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    return typeof o.s === 'string' ? [{ s: o.s.slice(0, 300), x: n(o.x), y: n(o.y), w: n(o.w), h: n(o.h), f: n(o.f) }] : []
  })
}

export async function POST(req: Request) {
  const session = await readSession()
  if (!session) return NextResponse.json({ ok: false, code: 'signed_out', message: 'Please sign in again.' }, { status: 401 })
  if (await isBlocked('sub', session.sub)) return NextResponse.json({ ok: false, code: 'blocked', message: 'This account has been suspended.' }, { status: 403 })
  const body = await readJson<{
    file_name?: string
    resume?: string
    roles?: unknown[]
    notes?: string
    links?: Record<string, unknown>
    pages?: Array<{ n?: number; width?: number; height?: number; items?: unknown; image?: unknown; vision?: unknown }>
  }>(req)

  const resume = String(body.resume ?? '').trim().slice(0, 20000)
  if (resume.length < 200) return NextResponse.json({ ok: false, code: 'invalid', message: 'We could not read enough text from that PDF. Export it again from your editor (not a scan) and try once more.' })
  const roles = (Array.isArray(body.roles) ? body.roles : []).map((r) => String(r).trim().slice(0, 100)).filter(Boolean).slice(0, 3)
  if (roles.length === 0) return NextResponse.json({ ok: false, code: 'invalid', message: 'Add at least one role you are targeting.' })
  const rawPages = (Array.isArray(body.pages) ? body.pages : []).slice(0, 2)
  if (rawPages.length === 0) return NextResponse.json({ ok: false, code: 'invalid', message: 'Upload your resume as a PDF.' })

  const account = await ensureAccount(session)
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 24)
  const pages = rawPages.map((p, k) => {
    const input: PageInput = { n: k + 1, width: Number(p.width) || 595, height: Number(p.height) || 842, items: items(p.items) }
    return { input, image: jpeg(p.image), vision: jpeg(p.vision, MAX_VISION_BYTES) }
  })
  await Promise.all([
    ...pages.filter((p) => p.image).map((p) => savePageImage(session.sub, id, p.input.n, p.image as Buffer)),
    ...pages.filter((p) => p.vision).map((p) => savePageImage(session.sub, id, p.input.n, p.vision as Buffer, 'v')),
  ])

  const now = new Date().toISOString()
  const review: Review = {
    id,
    sub: session.sub,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    currency: account.currency,
    charged: 0,
    input: {
      fileName: String(body.file_name ?? 'resume.pdf').slice(0, 120),
      resume,
      roles,
      notes: String(body.notes ?? '').trim().slice(0, 600),
      links: normalizeLinks(body.links),
      pages: pages.map((p) => ({ n: p.input.n, width: p.input.width, height: p.input.height, blocks: toBlocks(p.input), image: !!p.image, vision: !!p.vision })),
    },
  }
  if (review.input.pages.every((p) => p.blocks.length === 0)) {
    return NextResponse.json({ ok: false, code: 'invalid', message: 'That PDF has no readable text layer. Export it again from your editor (not a scan).' })
  }
  await createReview(review)
  return NextResponse.json({ ok: true, data: { id, links: review.input.links } })
}
