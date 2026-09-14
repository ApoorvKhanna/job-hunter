// One welcome credit per network. Sign-ups are keyed by the client IP's hash:
// the first Google account seen from an address holds it; later accounts from
// the same address are either created without the welcome credit (default) or
// turned away (`IP_GATE=block`). Existing accounts always sign in.
//
// Why credit-only by default: Indian mobile carriers and campus networks put
// thousands of real people behind one address. Withholding the free ₹49 stops
// the farm; blocking would lock out the second honest student in a hostel.
import { createHash } from 'node:crypto'
import { get, put } from '@vercel/blob'

export type GateMode = 'off' | 'credit' | 'block'
const MODES: GateMode[] = ['off', 'credit', 'block']
export const IP_GATE: GateMode = MODES.includes(process.env.IP_GATE as GateMode) ? (process.env.IP_GATE as GateMode) : 'credit'

/** The caller's address as Vercel presents it. Null off-platform. */
export function clientIp(req: Request): string | null {
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return null
}

export function networkKey(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

const path = (key: string) => `networks/${key}.json`

async function read(key: string): Promise<{ sub: string } | null> {
  const blob = await get(path(key), { access: 'private', useCache: false })
  if (!blob) return null
  return JSON.parse(await new Response(blob.stream).text()) as { sub: string }
}

/** Claim the network for `sub`. First writer wins; a lost race re-reads. */
export async function claimNetwork(ip: string, sub: string): Promise<{ holder: string; first: boolean }> {
  const key = networkKey(ip)
  const cur = await read(key)
  if (cur) return { holder: cur.sub, first: cur.sub === sub }
  try {
    await put(path(key), JSON.stringify({ sub, at: new Date().toISOString() }), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    })
    return { holder: sub, first: true }
  } catch {
    const again = await read(key)
    return again ? { holder: again.sub, first: again.sub === sub } : { holder: sub, first: true }
  }
}
