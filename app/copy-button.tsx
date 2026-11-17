'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from './icons'

// Copy with a visible answer: the copy icon blurs out as the check blurs in,
// and the label swaps in the same cell, so the button never changes width.
export default function CopyButton({ text, label = 'Copy', done: doneLabel = 'Copied', primary = false }: { text: string; label?: string; done?: string; primary?: boolean }) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return (
    <button
      type="button"
      className={`btn ${primary ? '' : 'ghost '}sm copy${done ? ' done' : ''}`}
      onClick={() => {
        void navigator.clipboard.writeText(text).catch(() => {})
        setDone(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setDone(false), 1600)
      }}
      aria-label={done ? doneLabel : label}
    >
      <span className="swap" aria-hidden="true">
        <Icon name="copy" size={14} weight={500} className={done ? 'off' : ''} />
        <Icon name="check" size={14} weight={500} className={done ? '' : 'off'} />
      </span>
      <span className="swap" aria-hidden="true">
        <span className={done ? 'off' : ''}>{label}</span>
        <span className={done ? '' : 'off'}>{doneLabel}</span>
      </span>
    </button>
  )
}
