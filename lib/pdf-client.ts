// Browser-only: read a resume PDF into what the review needs. Page images
// (JPEG, for the heatmap and for the model to look at), every text item with
// its position (to know what sits where), the links printed on it (to prefill
// profiles), and the plain text. Nothing leaves the browser until the user
// starts the review.
import type { RawItem } from './layout'

/** `image` is for display (about 1100px wide); `vision` is a smaller copy for
 *  the model, whose requests are capped at 512 KB. */
export interface PdfPage { n: number; width: number; height: number; image: string; vision: string; items: RawItem[] }
export interface PdfCapture { pages: PdfPage[]; links: string[]; text: string; numPages: number }

const r1 = (n: number) => Math.round(n * 10) / 10

export async function readPdf(file: File, maxPages = 2): Promise<PdfCapture> {
  const { getDocumentProxy, extractTextItems, extractLinks } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
  const numPages = pdf.numPages
  const [{ items }, links] = await Promise.all([extractTextItems(pdf), extractLinks(pdf).catch(() => ({ links: [] as string[] }))])
  // Plain text from the same items (extractText comes back near-empty in the
  // browser build): each item, a line break where PDF.js marks one.
  const text = items
    .map((page) => page.map((i) => i.str + (i.hasEOL ? '\n' : '')).join(''))
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const pages: PdfPage[] = []
  for (let n = 1; n <= Math.min(maxPages, numPages); n++) {
    const page = await pdf.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(2.4, 1100 / base.width) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport, background: '#ffffff' }).promise
    let image = canvas.toDataURL('image/jpeg', 0.82)
    if (image.length > 2_000_000) image = canvas.toDataURL('image/jpeg', 0.6)
    const small = document.createElement('canvas')
    small.width = 800
    small.height = Math.round((canvas.height * 800) / canvas.width)
    small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height)
    let vision = small.toDataURL('image/jpeg', 0.72)
    if (vision.length > 240_000) vision = small.toDataURL('image/jpeg', 0.5)
    pages.push({
      n,
      width: base.width,
      height: base.height,
      image,
      vision,
      items: (items[n - 1] ?? []).map((i) => ({ s: i.str, x: r1(i.x), y: r1(i.y), w: r1(i.width), h: r1(i.height), f: r1(i.fontSize) })),
    })
  }
  return { pages, links: Array.from(new Set(links.links)), text, numPages }
}
