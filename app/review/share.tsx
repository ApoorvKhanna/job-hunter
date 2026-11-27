'use client'

import { useEffect, useRef, useState } from 'react'
import { track } from '@/lib/track'

type Channel = 'linkedin' | 'whatsapp' | 'x' | 'copy'

/** The arrow-out-of-a-tray glyph, drawn like the icons in ../icons. */
function ShareGlyph() {
  return (
    <svg className="ico" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v7h14v-7" />
    </svg>
  )
}

// "Share my score": a public card with the scan score and the target roles
// only. The link is made when the menu first opens, so each channel below is
// a plain link the browser opens straight from the click, with no popup
// blocker in the way.
export default function ShareScore({ reviewId, score }: { reviewId: string; score: number | null }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const asking = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open || url || asking.current) return
    asking.current = true
    setError(null)
    fetch('/api/review/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: reviewId }) })
      .then((r) => r.json() as Promise<{ ok: boolean; message?: string; data?: { url: string } }>)
      .then((r) => {
        if (r.ok && r.data?.url) setUrl(r.data.url)
        else setError(r.message ?? 'Could not make a link. Try again.')
      })
      .catch(() => setError('Could not make a link. Try again.'))
      .finally(() => {
        asking.current = false
      })
  }, [open, url, reviewId])

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  if (score == null) return null

  const text = `A recruiter's 6-second scan of my resume: ${score}/100. Try yours free:`
  const clicked = (channel: Channel) => track('share_clicked', { channel, score })
  const links: Array<{ channel: Exclude<Channel, 'copy'>; label: string; href: string }> = url
    ? [
        { channel: 'linkedin', label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` },
        { channel: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}` },
        { channel: 'x', label: 'X', href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}` },
      ]
    : []

  function copy() {
    if (!url) return
    clicked('copy')
    void navigator.clipboard?.writeText(url).catch(() => {})
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="share" ref={box}>
      <button type="button" className="btn ghost sm" aria-expanded={open} aria-controls={`share-${reviewId}`} onClick={() => setOpen((o) => !o)}>
        <ShareGlyph /> Share my score
      </button>
      {open ? (
        <div className="share-menu" id={`share-${reviewId}`} aria-label="Share my score">
          {url ? (
            <>
              {links.map((l) => (
                <a key={l.channel} href={l.href} target="_blank" rel="noopener noreferrer" onClick={() => clicked(l.channel)}>{l.label}</a>
              ))}
              <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
              <input className="share-url" readOnly value={url} aria-label="Your share link" onFocus={(e) => e.currentTarget.select()} />
            </>
          ) : error ? (
            <div className="notice err" style={{ margin: 4 }}>{error}</div>
          ) : (
            <div className="share-wait small muted"><span className="spin" /> Making your link</div>
          )}
          <p className="small muted share-note">Shows your score and target roles. Never your name or your resume.</p>
        </div>
      ) : null}
    </div>
  )
}
