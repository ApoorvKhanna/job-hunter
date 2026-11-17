// One icon set. Stroke width follows the weight of the text the icon sits
// next to, so an icon never looks heavier or lighter than its label.
const PATHS = {
  copy: 'M9 9h10v11H9zM5 15V4h10',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1.5L20 20',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  resume: 'M7 3h7l4 4v14H7Zm7 0v4h4M9.5 12h5M9.5 15.5h5',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 8a5 5 0 0 1 10 0M16 10a2.5 2.5 0 1 0 0-5M17 14.5a4 4 0 0 1 3 4.5',
  mail: 'M4 6h16v12H4Zm0 1 8 6 8-6',
  pen: 'M5 19h4L19 9l-4-4L5 15v4Zm9-13 4 4',
  profile: 'M4 4h16v16H4ZM8 10v6M8 7v.01M12 16v-3.5a2 2 0 0 1 4 0V16M12 10v6',
  star: 'M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.4 6.7 19.1l1-5.8L3.5 9.2l5.9-.9Z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
} as const
export type IconName = keyof typeof PATHS

/** CSS font-weight of the neighbouring text → stroke width. */
function strokeFor(weight: number): number {
  if (weight >= 600) return 2
  if (weight >= 500) return 1.75
  return 1.5
}

export default function Icon({ name, size = 16, weight = 400, className }: { name: IconName; size?: number; weight?: number; className?: string }) {
  return (
    <svg className={className ? `ico ${className}` : 'ico'} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeFor(weight)} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
