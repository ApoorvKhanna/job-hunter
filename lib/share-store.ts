// Share cards: the 6-second scan score made public at /s/<token>. One private
// blob per card (`shares/<token>.json`) holding only what the public page
// shows (the score and the target roles) plus whose review it came from.
// Never the name, email, resume text, or anything else from the evaluation.
// One card per review: the token is kept on the review, claimed with the
// review's ETag check, so two clicks at once agree on one link.
import { get, put } from '@vercel/blob'
import { APP_URL } from './env'
import { getReview, updateReview } from './review-store'

export interface Share {
  token: string
  sub: string
  reviewId: string
  /** The scan score, 0 to 100. */
  score: number
  roles: string[]
  createdAt: string
}

const sharePath = (token: string) => `shares/${token}.json`

export const validToken = (token: string) => /^[A-Za-z0-9_-]{10,64}$/.test(token)
export const shareUrl = (token: string) => `${APP_URL}/s/${token}`

/** 15 random bytes as base64url: 20 characters, safe in a URL. */
export function newShareToken(): string {
  let s = ''
  for (const b of crypto.getRandomValues(new Uint8Array(15))) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The target roles as typed, tidied and capped for a public card. */
export function shareRoles(roles: string[]): string[] {
  return roles
    .map((r) => String(r ?? '').replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 5)
}

/** "A, B and C", or the first three "and 2 more", cut to fit one line. */
export function rolesLine(roles: string[], max = 90): string {
  const shown = roles.slice(0, 3)
  const rest = roles.length - shown.length
  const line = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : (shown[0] ?? '')
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

export async function getShare(token: string): Promise<Share | null> {
  if (!validToken(token)) return null
  const blob = await get(sharePath(token), { access: 'private', useCache: false })
  if (!blob) return null
  return JSON.parse(await new Response(blob.stream).text()) as Share
}

async function putShare(share: Share): Promise<void> {
  // Field by field, so nothing else can ever ride along into the public card.
  const record: Share = { token: share.token, sub: share.sub, reviewId: share.reviewId, score: share.score, roles: share.roles, createdAt: share.createdAt }
  await put(sharePath(share.token), JSON.stringify(record), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  })
}

class TokenTaken extends Error {
  constructor(readonly token: string) {
    super('share_token_taken')
  }
}

export type ShareOutcome ={ ok: true; share: Share } | { ok: false; code: 'not_found' | 'not_ready' | 'no_score'; message: string }

/** Make (or return) the share card for one of `sub`'s own reviews. */
export async function shareReview(sub: string, id: string): Promise<ShareOutcome> {
  const review = await getReview(sub, id)
  if (!review) return { ok: false, code: 'not_found', message: 'That review was not found.' }
  const scan = review.result?.scan ?? review.preview?.scan
  if (!scan) return { ok: false, code: 'not_ready', message: 'You can share your score once the scan is done.' }
  if (typeof scan.score !== 'number' || !Number.isFinite(scan.score)) return { ok: false, code: 'no_score', message: 'This scan has no score to share.' }
  const score = Math.max(0, Math.min(100, Math.round(scan.score)))
  const roles = shareRoles(review.input.roles)

  // Claim the token on the review first. If another click got there first,
  // the ETag check makes this one re-read, find that token, and stop without
  // writing (so many clicks at once do not keep colliding on the review).
  let token = review.shareToken
  if (!token) {
    const fresh = newShareToken()
    try {
      const saved = await updateReview(sub, id, (r) => {
        if (r.shareToken) throw new TokenTaken(r.shareToken)
        r.shareToken = fresh
      })
      token = saved.shareToken
    } catch (err) {
      if (!(err instanceof TokenTaken)) throw err
      token = err.token
    }
    if (!token) throw new Error('share_token_lost')
  }

  // Then the card. Written again only when missing or out of date, so a
  // card whose write failed last time is made on the next click.
  const existing = await getShare(token)
  if (existing && (existing.sub !== sub || existing.reviewId !== id)) throw new Error('share_conflict')
  if (existing && existing.score === score && existing.roles.join('\n') === roles.join('\n')) return { ok: true, share: existing }
  const share: Share = { token, sub, reviewId: id, score, roles, createdAt: existing?.createdAt ?? new Date().toISOString() }
  await putShare(share)
  return { ok: true, share }
}
