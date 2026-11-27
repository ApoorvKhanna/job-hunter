import { CARD_ALT, cardImage } from '../share-card'

export const alt = CARD_ALT
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: { token: string } | Promise<{ token: string }> }) {
  const { token } = await params
  return cardImage(token)
}
