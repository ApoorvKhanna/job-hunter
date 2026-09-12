// Everything the user has paid for, kept so they can come back to it.
// One private blob per user, newest first, capped. Separate from the ledger
// blob so a save can never collide with a debit.
import { BlobPreconditionFailedError, get, put } from '@vercel/blob'

export interface SavedJob {
  kind: 'job'
  at: string
  id: number
  title: string
  company: string
  location: string
  remote: boolean
  salary: string | null
  posted: string
  url: string
}
export interface SavedEmail {
  kind: 'email'
  at: string
  name: string
  title: string
  company: string
  linkedin_url: string
  emails: string[]
}
export interface SavedNote {
  kind: 'note'
  at: string
  subject: string
  body: string
  company: string
  jobTitle: string
  jobUrl: string
  person: string | null
  to: string | null
}
export type SavedItem = SavedJob | SavedEmail | SavedNote

const CAPS = { job: 150, email: 150, note: 100 } as const
const path = (sub: string) => `saved/${sub}.json`

async function load(sub: string): Promise<{ items: SavedItem[]; etag: string } | null> {
  const blob = await get(path(sub), { access: 'private', useCache: false })
  if (!blob) return null
  const text = await new Response(blob.stream).text()
  const etag = (blob.headers?.get('etag') ?? '').replace(/^W\//, '')
  try {
    const parsed = JSON.parse(text) as { items?: SavedItem[] }
    return { items: Array.isArray(parsed.items) ? parsed.items : [], etag }
  } catch {
    return { items: [], etag }
  }
}

export async function listSaved(sub: string): Promise<SavedItem[]> {
  return (await load(sub))?.items ?? []
}

/** Add items, newest first, de-duplicated per kind. Never throws: a failed
 *  save must not fail the paid step the user already got a result from. */
export async function saveItems(sub: string, incoming: SavedItem[]): Promise<void> {
  if (incoming.length === 0) return
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const found = await load(sub)
      const merged = [...incoming, ...(found?.items ?? [])]
      const seen = new Set<string>()
      const kept: SavedItem[] = []
      const counts: Record<string, number> = { job: 0, email: 0, note: 0 }
      for (const it of merged) {
        const key =
          it.kind === 'job' ? `job:${it.id}` : it.kind === 'email' ? `email:${it.linkedin_url}` : `note:${it.at}:${it.subject}`
        if (seen.has(key)) continue
        if (counts[it.kind] >= CAPS[it.kind]) continue
        seen.add(key)
        counts[it.kind]++
        kept.push(it)
      }
      await put(path(sub), JSON.stringify({ items: kept }), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        ...(found?.etag ? { ifMatch: found.etag } : {}),
      })
      return
    } catch (err) {
      const stale = err instanceof BlobPreconditionFailedError || /precondition/i.test(String((err as Error)?.message ?? ''))
      if (!stale || attempt === 3) {
        console.error('[saved] write failed', sub, err)
        return
      }
      await new Promise((r) => setTimeout(r, 120 * (attempt + 1)))
    }
  }
}

/** "Subject: X\n\nbody" → { subject, body } */
export function splitNote(note: string): { subject: string; body: string } {
  const lines = note.split('\n')
  const first = lines[0] ?? ''
  if (/^subject:/i.test(first.trim())) {
    return { subject: first.replace(/^subject:\s*/i, '').trim(), body: lines.slice(1).join('\n').trim() }
  }
  return { subject: '', body: note.trim() }
}
