// Sanity check for a UPI payment reference before we trust it.
//
// What real references look like: the 12-digit UTR / RRN every UPI app shows
// ("Transaction ID" / "UPI Ref"), or a bank-side id of 16–24 digits, or a
// mixed id with a short letter prefix such as Paytm's T + 22 digits. What we
// refuse: phone numbers, words, repeated or sequential digits, anything with
// more letters than a reference could carry.
export type UtrCheck = { ok: true; utr: string } | { ok: false; message: string }

export function normalizeUtr(raw: string): string {
  return raw.replace(/[\s.\-_/]/g, '').toUpperCase()
}

function isRun(digits: string): boolean {
  if (digits.length < 8) return false
  let asc = 0
  let desc = 0
  for (let i = 1; i < digits.length; i++) {
    const d = Number(digits[i]) - Number(digits[i - 1])
    if (d === 1 || d === -9) asc++
    if (d === -1 || d === 9) desc++
  }
  return asc >= digits.length - 2 || desc >= digits.length - 2
}

export function looksLikeUtr(raw: string): UtrCheck {
  const utr = normalizeUtr(String(raw ?? ''))
  const invalid = (message: string): UtrCheck => ({ ok: false, message })
  if (!utr) return invalid('Enter the UTR / transaction ID from your UPI app.')
  if (!/^[A-Z0-9]+$/.test(utr)) return invalid('A UTR has only letters and digits. Copy it from your UPI app.')
  const digits = utr.replace(/\D/g, '')
  const letters = utr.length - digits.length
  if (/^[6-9]\d{9}$/.test(utr)) return invalid('That looks like a phone number. We need the 12-digit UTR from the payment details.')
  if (digits.length < 10) return invalid('That does not look like a UTR. It is usually 12 digits, shown in your UPI app under the payment.')
  if (letters > 6) return invalid('That does not look like a UTR. It is mostly digits, shown in your UPI app under the payment.')
  if (letters === 0 && !(utr.length === 12 || (utr.length >= 16 && utr.length <= 24)))
    return invalid('A UTR is 12 digits (some banks show 16–22). Check the number and try again.')
  if (letters > 0 && (utr.length < 12 || utr.length > 35)) return invalid('That does not look like a UTR. Copy it exactly from your UPI app.')
  if (new Set(digits).size < 4) return invalid('That does not look like a real UTR.')
  if (isRun(digits)) return invalid('That does not look like a real UTR.')
  return { ok: true, utr }
}
