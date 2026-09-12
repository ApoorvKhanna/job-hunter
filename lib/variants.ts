// The paid rewrites offered under a drafted note.
export const VARIANTS = {
  friendly: 'Rewrite it warmer and more human. Contractions are fine. Keep it professional, never casual to the point of sloppy.',
  short: 'Cut it to 60 to 80 words. Keep the single strongest proof point and drop the rest. Same subject line style.',
  formal: 'Rewrite it more formal and restrained. No contractions. Address them by full name in the greeting.',
} as const
export type Variant = keyof typeof VARIANTS

export const VARIANT_LABELS: Array<{ id: Variant; label: string }> = [
  { id: 'friendly', label: 'Friendlier' },
  { id: 'short', label: 'Shorter' },
  { id: 'formal', label: 'More formal' },
]
