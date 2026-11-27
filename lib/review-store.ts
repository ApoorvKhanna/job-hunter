// Reviews, one private blob each (`reviews/<sub>/<id>.json`), plus the page
// images the heatmap is drawn on (`reviews/<sub>/<id>/p<n>.jpg`). Status
// moves draft → running → done | failed, written with ETag checks so a double
// click can never run (or charge) a review twice. A draft may carry a free
// preview (the scan alone) before it is paid for.
import { BlobPreconditionFailedError, get, put } from '@vercel/blob'
import type { Block, Fixation } from './layout'
import type { Links, SourceKey, SourceState } from './profiles'
import type { Currency } from './prices'

export interface ScanResult {
  fixations: Fixation[]
  six_seconds: string
  seen: string[]
  missed: Array<{ id: string; what: string; fix: string }>
  layout: Array<{ issue: string; fix: string }>
  score: number | null
  /** How the scan was made: the model looking at the page, the model
   *  reading the layout as text, or layout rules alone. */
  method: 'vision' | 'layout' | 'rules'
}

export interface Evaluation {
  headline: string
  overall: number | null
  profiles: Array<{ source: 'resume' | SourceKey; score: number | null; verdict: string; strengths: string[]; fixes: string[] }>
  consistency: Array<{ issue: string; fix: string }>
  roles: Array<{ role: string; fit: number | null; verdict: string; strengths: string[]; gaps: string[]; resume_changes: string[]; keywords: string[] }>
  rewrites: { headline: string; summary: string; bullets: Array<{ before: string; after: string }> }
  plan: string[]
}

export interface ReviewPage { n: number; width: number; height: number; blocks: Block[]; image: boolean; vision?: boolean }

export interface Review {
  id: string
  sub: string
  createdAt: string
  updatedAt: string
  status: 'draft' | 'running' | 'done' | 'failed'
  stage?: 'profiles' | 'analysis'
  error?: string
  currency: Currency
  /** What was debited for this review (0 until it starts). */
  charged: number
  input: {
    fileName: string
    resume: string
    roles: string[]
    notes: string
    links: Links
    pages: ReviewPage[]
  }
  /** The free 6-second scan, made before paying. The paid run reuses it. */
  preview?: { scan: ScanResult; at: string }
  result?: {
    scan: ScanResult
    evaluation: Evaluation
    sources: Record<SourceKey, SourceState>
    model: string
    finishedAt: string
  }
}

const jsonPath = (sub: string, id: string) => `reviews/${sub}/${id}.json`
/** `v` is the smaller copy the model looks at. */
const imagePath = (sub: string, id: string, n: number, variant: '' | 'v' = '') => `reviews/${sub}/${id}/p${n}${variant ? `-${variant}` : ''}.jpg`

export const validId = (id: string) => /^[a-z0-9]{8,40}$/.test(id)

async function load(sub: string, id: string): Promise<{ review: Review; etag: string } | null> {
  if (!validId(id)) return null
  const blob = await get(jsonPath(sub, id), { access: 'private', useCache: false })
  if (!blob) return null
  const text = await new Response(blob.stream).text()
  const etag = (blob.headers?.get('etag') ?? '').replace(/^W\//, '')
  return { review: JSON.parse(text) as Review, etag }
}

export async function getReview(sub: string, id: string): Promise<Review | null> {
  return (await load(sub, id))?.review ?? null
}

export async function createReview(review: Review): Promise<void> {
  await put(jsonPath(review.sub, review.id), JSON.stringify(review), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: false,
  })
}

/** Apply `fn` with an ETag check. `fn` may throw to abort without writing. */
export async function updateReview(sub: string, id: string, fn: (r: Review) => void): Promise<Review> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await load(sub, id)
    if (!found) throw new Error('no_review')
    const next = structuredClone(found.review)
    fn(next)
    next.updatedAt = new Date().toISOString()
    try {
      await put(jsonPath(sub, id), JSON.stringify(next), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        ...(found.etag ? { ifMatch: found.etag } : {}),
      })
      return next
    } catch (err) {
      const stale = err instanceof BlobPreconditionFailedError || /precondition/i.test(String((err as Error)?.message ?? ''))
      if (!stale || attempt === 3) throw err
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
    }
  }
  throw new Error('review_contention')
}

export async function savePageImage(sub: string, id: string, n: number, jpeg: Buffer, variant: '' | 'v' = ''): Promise<void> {
  await put(imagePath(sub, id, n, variant), jpeg, {
    access: 'private',
    contentType: 'image/jpeg',
    addRandomSuffix: false,
    allowOverwrite: true,
  })
}

export async function readPageImage(sub: string, id: string, n: number, variant: '' | 'v' = ''): Promise<Buffer | null> {
  if (!validId(id) || !Number.isInteger(n) || n < 1 || n > 4) return null
  const blob = await get(imagePath(sub, id, n, variant), { access: 'private' })
  if (!blob) return null
  return Buffer.from(await new Response(blob.stream).arrayBuffer())
}
