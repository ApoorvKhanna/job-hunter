// The share card as an image (1200 by 630), for LinkedIn, WhatsApp and X to
// unfurl. Drawn by next/og: flexbox and inline styles only. The site's look:
// a lapis hero, a marble band, a line of gold. next/og carries one font (Noto
// Sans), so the score is set large in that rather than the site's serif.
import { ImageResponse } from 'next/og'
import { getShare, rolesLine } from '@/lib/share-store'

const LAPIS = '#1e2f96'
const MARBLE = '#f4f1ea'
const GOLD = '#b8913a'
const GOLD_LIGHT = '#dcc17f'
const INK = '#1d2030'

export const CARD_SIZE = { width: 1200, height: 630 }
export const CARD_ALT = 'A recruiter’s 6-second scan of a resume, scored out of 100'

function Card({ score, roles }: { score: number | null; roles: string }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: LAPIS, color: MARBLE }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 84px' }}>
        <div style={{ display: 'flex', fontSize: 30, letterSpacing: 5, textTransform: 'uppercase', color: GOLD_LIGHT }}>A recruiter’s 6-second scan</div>
        {score == null ? (
          <div style={{ display: 'flex', fontSize: 92, lineHeight: 1.05, marginTop: 22, maxWidth: 980 }}>See your resume the way a recruiter does</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 4 }}>
            <div style={{ display: 'flex', fontSize: 240, lineHeight: 1, letterSpacing: -6 }}>{String(score)}</div>
            <div style={{ display: 'flex', fontSize: 64, color: GOLD_LIGHT, marginLeft: 14, marginBottom: 30 }}>/100</div>
          </div>
        )}
        {roles ? <div style={{ display: 'flex', fontSize: 38, opacity: 0.88, marginTop: 14, maxWidth: 1030 }}>{`For ${roles}`}</div> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 116, padding: '0 84px', background: MARBLE, color: INK, borderTop: `6px solid ${GOLD}` }}>
        <div style={{ display: 'flex', fontSize: 38, letterSpacing: -0.5 }}>thejobhunter.in</div>
        <div style={{ display: 'flex', fontSize: 30, color: LAPIS }}>Get your free 6-second scan</div>
      </div>
    </div>
  )
}

/** The image for one share token. An unknown token gets the plain card. */
export async function cardImage(token: string): Promise<ImageResponse> {
  const share = await getShare(token).catch(() => null)
  return new ImageResponse(<Card score={share?.score ?? null} roles={share ? rolesLine(share.roles, 60) : ''} />, {
    ...CARD_SIZE,
    // A card's score does not change once shared; a day keeps unfurls fast
    // without pinning the image forever the way the default (a year) would.
    headers: { 'cache-control': 'public, max-age=86400, s-maxage=86400' },
  })
}
