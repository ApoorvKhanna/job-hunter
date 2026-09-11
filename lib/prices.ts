// Every price the UI shows next to a button. Vaaya quotes these per call;
// a refused or failed call costs nothing.
export const PRICES = {
  parse: 'under 1¢',
  jobs: '40¢',
  contact: '3¢',
  email: '10¢',
  draft: 'under 1¢',
} as const

export const JOBS_PRICE_CENTS = 40
export const CONTACT_PAGE_SIZE = 3
export const CONTACT_PRICE_CENTS = CONTACT_PAGE_SIZE
export const EMAIL_PRICE_CENTS = 10
