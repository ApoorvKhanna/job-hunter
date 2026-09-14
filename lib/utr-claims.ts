// One payment reference credits one account, once. First writer wins, same
// pattern as the network gate, so a UTR pasted into a second account (or the
// same account twice) is caught before any credit moves.
import { get, put } from '@vercel/blob'

const path = (utr: string) => `utrs/${utr}.json`

async function read(utr: string): Promise<{ sub: string } | null> {
  const blob = await get(path(utr), { access: 'private', useCache: false })
  if (!blob) return null
  return JSON.parse(await new Response(blob.stream).text()) as { sub: string }
}

/** Claim the reference for `sub`. Returns who holds it. */
export async function claimUtr(utr: string, sub: string): Promise<{ holder: string; first: boolean }> {
  const cur = await read(utr)
  if (cur) return { holder: cur.sub, first: false }
  try {
    await put(path(utr), JSON.stringify({ sub, at: new Date().toISOString() }), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    })
    return { holder: sub, first: true }
  } catch {
    const again = await read(utr)
    return again ? { holder: again.sub, first: false } : { holder: sub, first: true }
  }
}
