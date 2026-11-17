'use client'

import { useEffect, useRef, useState } from 'react'
import type { Block, Fixation } from '@/lib/layout'

export type HeatMode = 'heat' | 'path' | 'missed'

// Thermal ramp, interpolated in OKLCH so the middle stays vivid instead of
// going muddy: cool blue at the edge of attention, red where it dwells.
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [0.55, 0.2, 264]],
  [0.3, [0.74, 0.13, 215]],
  [0.5, [0.78, 0.17, 145]],
  [0.72, [0.9, 0.17, 100]],
  [1, [0.63, 0.22, 32]],
]

function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return lin.map((x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, v)) * 255)
  }) as [number, number, number]
}

const LUT = (() => {
  const out = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let k = 0
    while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++
    const [t0, c0] = STOPS[k]
    const [t1, c1] = STOPS[k + 1]
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
    let dh = c1[2] - c0[2]
    if (dh > 180) dh -= 360
    if (dh < -180) dh += 360
    const [r, g, b] = oklchToRgb(c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + dh * f)
    out[i * 3] = r
    out[i * 3 + 1] = g
    out[i * 3 + 2] = b
  }
  return out
})()

/** Where on a line the eye lands: near its start (people read the left
 *  edge of a line, F-pattern), vertically centred. */
function anchor(b: Block, W: number, H: number) {
  const span = Math.min(b.w, 0.3)
  return { x: (b.x + span * 0.4) * W, y: (b.y + b.h / 2) * H, rx: Math.max(span * W * 0.75, W * 0.05), ry: Math.max(b.h * H * 2.8, W * 0.036) }
}

const easeOut = (t: number) => 1 - (1 - t) ** 3
/** Overshoot, then settle: follow-through for the markers. */
const easeBack = (t: number) => {
  const c1 = 1.70158
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

function drawHeat(ctx: CanvasRenderingContext2D, W: number, H: number, blocks: Map<string, Block>, fixations: Fixation[]) {
  const off = document.createElement('canvas')
  off.width = W
  off.height = H
  const o = off.getContext('2d')
  if (!o) return
  for (const f of fixations) {
    const b = blocks.get(f.id)
    if (!b) continue
    const a = anchor(b, W, H)
    o.save()
    o.translate(a.x, a.y)
    o.scale(1, a.ry / a.rx)
    const g = o.createRadialGradient(0, 0, 0, 0, 0, a.rx)
    g.addColorStop(0, `rgba(0,0,0,${0.6 + 0.4 * f.dwell})`)
    g.addColorStop(0.5, `rgba(0,0,0,${0.3 * f.dwell + 0.15})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    o.fillStyle = g
    o.beginPath()
    o.arc(0, 0, a.rx, 0, Math.PI * 2)
    o.fill()
    o.restore()
  }
  const img = o.getImageData(0, 0, W, H)
  const px = img.data
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i + 3]
    if (v < 6) {
      px[i + 3] = 0
      continue
    }
    px[i] = LUT[v * 3]
    px[i + 1] = LUT[v * 3 + 1]
    px[i + 2] = LUT[v * 3 + 2]
    px[i + 3] = Math.min(190, 40 + v * 0.75)
  }
  ctx.putImageData(img, 0, 0)
}

/** The scan path at time t (0..1): arcs between fixations draw themselves,
 *  and each marker springs in as the line reaches it. */
function drawPath(ctx: CanvasRenderingContext2D, W: number, H: number, blocks: Map<string, Block>, fixations: Fixation[], t: number) {
  const unit = W / 900
  const pts = fixations.flatMap((f) => {
    const b = blocks.get(f.id)
    return b ? [{ f, ...anchor(b, W, H) }] : []
  })
  const n = pts.length
  if (n === 0) return
  const span = 0.82 // the rest of the time lets the last marker settle
  const at = (i: number) => (i / Math.max(1, n - 1)) * span

  ctx.lineWidth = 2.5 * unit
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'oklch(0.37 0.17 269 / 0.55)'
  ctx.setLineDash([7 * unit, 6 * unit])
  for (let i = 0; i < n - 1; i++) {
    const local = Math.min(1, Math.max(0, (t - at(i)) / (at(i + 1) - at(i))))
    if (local <= 0) break
    const p = pts[i]
    const q = pts[i + 1]
    // Moving in arcs: the control point bows off the straight line.
    const mx = (p.x + q.x) / 2
    const my = (p.y + q.y) / 2
    const dx = q.x - p.x
    const dy = q.y - p.y
    const cx = mx - dy * 0.22
    const cy = my + dx * 0.22
    const e = easeOut(local)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    const steps = 24
    for (let s = 1; s <= Math.ceil(steps * e); s++) {
      const u = Math.min(e, s / steps)
      const x = (1 - u) ** 2 * p.x + 2 * (1 - u) * u * cx + u ** 2 * q.x
      const y = (1 - u) ** 2 * p.y + 2 * (1 - u) * u * cy + u ** 2 * q.y
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.setLineDash([])

  pts.forEach((p, i) => {
    const local = Math.min(1, Math.max(0, (t - at(i)) / 0.18))
    if (local <= 0) return
    const k = easeBack(local)
    const r = (11 + 9 * p.f.dwell) * unit * k
    ctx.globalAlpha = Math.min(1, local * 2)
    ctx.fillStyle = 'oklch(0.37 0.17 269 / 0.93)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(0, r), 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `600 ${Math.round((12 + 4 * p.f.dwell) * unit * Math.max(0.6, k))}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(p.f.order), p.x, p.y + 0.5)
    ctx.globalAlpha = 1
  })
}

function drawMissed(ctx: CanvasRenderingContext2D, W: number, H: number, blocks: Map<string, Block>, missed: string[]) {
  const unit = W / 900
  ctx.lineWidth = 3 * unit
  ctx.setLineDash([9 * unit, 6 * unit])
  missed.forEach((id, i) => {
    const b = blocks.get(id)
    if (!b) return
    const pad = 6 * unit
    ctx.strokeStyle = 'oklch(0.52 0.17 28 / 0.9)'
    ctx.fillStyle = 'oklch(0.52 0.17 28 / 0.08)'
    ctx.beginPath()
    ctx.roundRect(b.x * W - pad, b.y * H - pad, b.w * W + pad * 2, b.h * H + pad * 2, 4 * unit)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = 'oklch(0.52 0.17 28 / 0.95)'
    ctx.beginPath()
    ctx.arc(b.x * W - pad, b.y * H - pad, 11 * unit, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${Math.round(12 * unit)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String.fromCharCode(65 + i), b.x * W - pad, b.y * H - pad + 0.5)
  })
  ctx.setLineDash([])
}

export default function Heatmap({ src, alt, blocks, fixations, missed, mode }: { src: string; alt: string; blocks: Block[]; fixations: Fixation[]; missed: string[]; mode: HeatMode }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const shown = useRef<HeatMode | null>(null)

  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth) setSize({ w: img.naturalWidth, h: img.naturalHeight })
  }, [src])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!size || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const map = new Map(blocks.map((b) => [b.id, b]))
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let swapTimer: ReturnType<typeof setTimeout> | null = null

    const paint = () => {
      canvas.width = size.w
      canvas.height = size.h
      ctx.clearRect(0, 0, size.w, size.h)
      if (mode === 'heat') drawHeat(ctx, size.w, size.h, map, fixations)
      else if (mode === 'missed') drawMissed(ctx, size.w, size.h, map, missed)
      else if (still) drawPath(ctx, size.w, size.h, map, fixations, 1)
      else {
        const start = performance.now()
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / 900)
          ctx.clearRect(0, 0, size.w, size.h)
          drawPath(ctx, size.w, size.h, map, fixations, t)
          if (t < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      }
      canvas.classList.remove('swapping')
      shown.current = mode
    }

    // Changing views: the old overlay blurs out before the new one comes in.
    if (shown.current && shown.current !== mode && !still) {
      canvas.classList.add('swapping')
      swapTimer = setTimeout(paint, 120)
    } else paint()

    return () => {
      cancelAnimationFrame(raf)
      if (swapTimer) clearTimeout(swapTimer)
    }
  }, [size, blocks, fixations, missed, mode])

  return (
    <div className="heat-wrap">
      <div className="page">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} src={src} alt={alt} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
    </div>
  )
}
