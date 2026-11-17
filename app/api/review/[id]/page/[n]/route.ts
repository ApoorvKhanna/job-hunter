// A review's page image, only to the account that owns it.
import { readPageImage } from '@/lib/review-store'
import { readSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const session = await readSession()
  if (!session) return new Response('signed out', { status: 401 })
  const { id, n } = await ctx.params
  const buf = await readPageImage(session.sub, id, Number(n))
  if (!buf) return new Response('not found', { status: 404 })
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' } })
}
