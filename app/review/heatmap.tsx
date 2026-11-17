'use client'

import { useEffect, useRef, useState } from 'react'
import type { Block, Fixation } from '@/lib/layout'

export type HeatMode = 'heat' | 'path' | 'missed' | 'off'

// Thermal palette: cool blue at the edge of attention, red where it dwells.
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [40, 70, 255]],
  [0.3, [0, 190, 230]],
  [0.5, [40, 210, 90]],
  [0.7, [255, 220, 0]],
  [1, [240, 40, 20]],
]
const LUT = (() => {
  const out = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let k = 0
    while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++
    const [t0, c0] = STOPS[k]
    const [t1, c1] = STOPS[k + 1]
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(c0[c] + (c1[c] - c0[c]) * f)
  }
  return out
})()

/** Where on a line the eye lands: near its start (people read the left
 *  edge of a line, F-pattern), vertically centred. */
function anchor(b: Block, W: number, H: number) {
  const span = Math.min(b.w, 0.3)
  return { x: (b.x + span * 0.4) * W, y: (b.y + b.h / 2) * H, rx: Math.max(span * W * 0.75, W * 0.05), ry: Math.max(b.h * H * 2.8, W * 0.036) }
}

function draw(canvas: HTMLCanvasElement, W: number, H: number, blocks: Map<string, Block>, fixations: Fixation[], missed: string[], mode: HeatMode) {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, W, H)
  if (mode === 'off') return

  if (mode === 'heat') {
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
    return
  }

  const unit = W / 900
  if (mode === 'path') {
    const pts = fixations.flatMap((f) => {
      const b = blocks.get(f.id)
      return b ? [{ f, ...anchor(b, W, H) }] : []
    })
    ctx.strokeStyle = 'rgba(30, 47, 150, 0.55)'
    ctx.lineWidth = 2.5 * unit
    ctx.setLineDash([7 * unit, 6 * unit])
    ctx.beginPath()
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
    ctx.setLineDash([])
    for (const p of pts) {
      const r = (11 + 9 * p.f.dwell) * unit
      ctx.fillStyle = 'rgba(30, 47, 150, 0.92)'
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = `600 ${Math.round(12 * unit + 4 * p.f.dwell * unit)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(p.f.order), p.x, p.y + 0.5)
    }
    return
  }

  // missed: what the scan skips, boxed.
  ctx.lineWidth = 3 * unit
  ctx.setLineDash([9 * unit, 6 * unit])
  missed.forEach((id, i) => {
    const b = blocks.get(id)
    if (!b) return
    const pad = 6 * unit
    ctx.strokeStyle = 'rgba(179, 38, 30, 0.9)'
    ctx.fillStyle = 'rgba(179, 38, 30, 0.08)'
    ctx.beginPath()
    ctx.rect(b.x * W - pad, b.y * H - pad, b.w * W + pad * 2, b.h * H + pad * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = 'rgba(179, 38, 30, 0.95)'
    ctx.beginPath()
    ctx.arc(b.x * W - pad, b.y * H - pad, 11 * unit, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${Math.round(12 * unit)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String.fromCharCode(65 + i), b.x * W - pad, b.y * H - pad + 0.5)
  })
}

export default function Heatmap({ src, alt, blocks, fixations, missed, mode }: { src: string; alt: string; blocks: Block[]; fixations: Fixation[]; missed: string[]; mode: HeatMode }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth) setSize({ w: img.naturalWidth, h: img.naturalHeight })
  }, [src])

  useEffect(() => {
    if (!size || !canvasRef.current) return
    draw(canvasRef.current, size.w, size.h, new Map(blocks.map((b) => [b.id, b])), fixations, missed, mode)
  }, [size, blocks, fixations, missed, mode])

  return (
    <div className="heat-wrap">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={src} alt={alt} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>
  )
}
