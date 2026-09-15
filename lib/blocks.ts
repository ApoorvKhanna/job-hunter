// Operator blocks: an account (by Google sub) or a whole network (the hashed
// address from ipgate.ts). One private blob per block so a block is one
// write and a check is one read; reads are cached briefly per function
// instance so the paid routes do not pay a blob round-trip on every call.
import { get, put } from '@vercel/blob'

export type BlockKind = 'sub' | 'network'
const path = (kind: BlockKind, key: string) => `blocks/${kind}s/${key}.json`
const cache = new Map<string, { until: number; blocked: boolean }>()
const TTL = 60_000

export async function isBlocked(kind: BlockKind, key: string | null | undefined): Promise<boolean> {
  if (!key) return false
  const k = `${kind}:${key}`
  const hit = cache.get(k)
  if (hit && hit.until > Date.now()) return hit.blocked
  let blocked = false
  try {
    blocked = !!(await get(path(kind, key), { access: 'private', useCache: false }))
  } catch {
    blocked = false
  }
  cache.set(k, { until: Date.now() + TTL, blocked })
  return blocked
}

export async function block(kind: BlockKind, key: string, reason: string): Promise<void> {
  await put(path(kind, key), JSON.stringify({ at: new Date().toISOString(), reason }), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  })
  cache.set(`${kind}:${key}`, { until: Date.now() + TTL, blocked: true })
}
