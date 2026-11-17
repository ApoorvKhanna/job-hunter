// Resume layout: the PDF's text items (read in the browser) grouped into the
// visual lines a reader's eye can land on, with their position on the page.
// Shared by the client (types) and the review pipeline (grouping + the
// fallback scan when no model answers).

/** One PDF.js text item, compact keys. PDF space: points, origin bottom-left. */
export interface RawItem { s: string; x: number; y: number; w: number; h: number; f: number }

export interface PageInput {
  n: number
  /** Page size in PDF points. */
  width: number
  height: number
  items: RawItem[]
}

/** A visual line segment. Position and size are fractions of the page,
 *  origin top-left. `size` is font size relative to the body text. */
export interface Block { id: string; page: number; text: string; x: number; y: number; w: number; h: number; size: number }

export interface Fixation { id: string; order: number; dwell: number; note: string }

const round = (n: number) => Math.round(n * 1000) / 1000

function median(values: number[]): number {
  if (values.length === 0) return 10
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Group a page's items into line segments. A row splits wherever the gap
 *  between items is wider than about two characters, so a two-column layout
 *  or a right-aligned date becomes its own block. */
export function toBlocks(page: PageInput, maxBlocks = 180): Block[] {
  const W = page.width || 595
  const H = page.height || 842
  const items = page.items
    .filter((i) => typeof i.s === 'string' && i.s.trim() && Number.isFinite(i.x) && Number.isFinite(i.y))
    .map((i) => {
      const fs = i.f > 0 ? i.f : i.h > 0 ? i.h : 10
      return { s: i.s, left: i.x, right: i.x + Math.max(i.w, fs * 0.3), top: H - i.y - fs * 0.85, bottom: H - i.y + fs * 0.2, fs }
    })
    .sort((a, b) => a.top - b.top || a.left - b.left)

  // Body size: the font size carrying the most characters.
  const weight = new Map<number, number>()
  for (const i of items) {
    const fs = Math.round(i.fs * 2) / 2
    weight.set(fs, (weight.get(fs) ?? 0) + i.s.length)
  }
  let body = median(items.map((i) => i.fs))
  let best = 0
  for (const [fs, chars] of weight) {
    if (chars > best) {
      best = chars
      body = fs
    }
  }

  // Rows: items whose vertical centres sit within half a line of each other.
  const rows: Array<typeof items> = []
  for (const it of items) {
    const mid = (it.top + it.bottom) / 2
    const row = rows.find((r) => {
      const rm = (r[0].top + r[0].bottom) / 2
      return Math.abs(rm - mid) < Math.max(r[0].fs, it.fs) * 0.5
    })
    if (row) row.push(it)
    else rows.push([it])
  }

  const blocks: Block[] = []
  for (const row of rows) {
    row.sort((a, b) => a.left - b.left)
    let seg: typeof items = []
    const flush = () => {
      if (seg.length === 0) return
      let text = ''
      for (let k = 0; k < seg.length; k++) {
        const gap = k > 0 ? seg[k].left - seg[k - 1].right : 0
        text += (k > 0 && gap > seg[k].fs * 0.15 && !text.endsWith(' ') && !seg[k].s.startsWith(' ') ? ' ' : '') + seg[k].s
      }
      text = text.replace(/\s+/g, ' ').trim()
      if (text) {
        const left = Math.min(...seg.map((i) => i.left))
        const right = Math.max(...seg.map((i) => i.right))
        const top = Math.min(...seg.map((i) => i.top))
        const bottom = Math.max(...seg.map((i) => i.bottom))
        const fs = Math.max(...seg.map((i) => i.fs))
        blocks.push({
          id: '',
          page: page.n,
          text: text.slice(0, 160),
          x: round(Math.max(0, left / W)),
          y: round(Math.max(0, top / H)),
          w: round(Math.min(1, (right - left) / W)),
          h: round(Math.min(1, (bottom - top) / H)),
          size: Math.round((fs / body) * 10) / 10,
        })
      }
      seg = []
    }
    for (const it of row) {
      const last = seg[seg.length - 1]
      if (last && it.left - last.right > Math.max(last.fs, it.fs) * 1.8) flush()
      seg.push(it)
    }
    flush()
  }

  blocks.sort((a, b) => a.y - b.y || a.x - b.x)
  return blocks.slice(0, maxBlocks).map((b, k) => ({ ...b, id: `p${page.n}-${k + 1}` }))
}

/** One line per block for a model: "p1-3 | x .06 y .04 w .30 h .02 | 2.1 | Jane Doe" */
export function describeBlocks(blocks: Block[]): string {
  const f = (n: number) => n.toFixed(2).replace(/^0/, '')
  return blocks.map((b) => `${b.id} | x ${f(b.x)} y ${f(b.y)} w ${f(b.w)} h ${f(b.h)} | ${b.size} | ${b.text}`).join('\n')
}

/** The scan a recruiter's eye is likely to make, from layout alone: big and
 *  short lines near the top and the left edge, numbers and dates, page one
 *  over page two. Used when the model gives no usable answer. */
export function priorScan(blocks: Block[], count = 10): Fixation[] {
  const scored = blocks.map((b) => {
    const words = b.text.split(/\s+/).length
    let s = 1.4 * Math.min(b.size, 2.5)
    s += b.y < 0.14 ? 1.2 : 0
    s += b.x < 0.2 ? 0.4 : 0
    s += /\d/.test(b.text) ? 0.3 : 0
    s += words <= 7 ? 0.4 : 0
    s -= b.text.length > 110 ? 0.8 : 0
    s -= b.y * 0.9
    s -= b.page > 1 ? 1.6 : 0
    return { b, s }
  })
  const top = scored.sort((a, z) => z.s - a.s).slice(0, count)
  const max = top[0]?.s || 1
  return top
    .sort((a, z) => a.b.page - z.b.page || Math.round(a.b.y * 10) - Math.round(z.b.y * 10) || a.b.x - z.b.x)
    .map((t, k) => ({ id: t.b.id, order: k + 1, dwell: Math.max(0.2, Math.min(1, t.s / max)), note: '' }))
}
