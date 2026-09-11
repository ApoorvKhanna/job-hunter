# Job Hunter

Upload a resume. Get matching postings, the person hiring at each company,
their email, and a short note to send. Every step is priced in rupees, charged
only on success. New accounts start with ₹49; recharge by UPI.

Live: https://job-hunter-in.vercel.app

## How it is built

- Next.js 15, no database server. Each user's balance and history is one
  private JSON blob in Vercel Blob (`users/<google-sub>.json`), written with
  optimistic ETag checks.
- Sign in with Google (plain OAuth 2.0, no auth library). Identity lives in
  one AES-GCM encrypted cookie.
- Job, contact and drafting data come from a metered data backend behind one
  operator key. The user never sees that backend. Prices in `lib/prices.ts`
  are what the user pays; the backend's cost per step is roughly the same
  number in US cents.
- UPI recharges are manual: the user pays the QR, types the UTR, and the
  operator approves it on `/admin?token=…`. The credit lands on approval.

## Steps and prices

| Step | Price |
| --- | --- |
| Read the resume | ₹1 |
| Ten matching postings | ₹20 |
| Three people at a company | ₹3 |
| Reveal one email | ₹10 |
| Draft the note | ₹1 |

## Setup

Environment variables (all on Vercel → Settings → Environment Variables):

| Name | What |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | A Google OAuth web client with redirect URI `https://<host>/api/auth/google/callback` |
| `PROVIDER_API_KEY` | The operator's data-backend key |
| `SESSION_SECRET` | 32+ random characters |
| `APP_URL` | `https://<host>`, no trailing slash |
| `BLOB_READ_WRITE_TOKEN` | From the connected Vercel Blob store |
| `UPI_ID`, `UPI_NAME` | Where recharges go, e.g. `name@upi` |
| `ADMIN_TOKEN` | Guards `/admin` and the recharge approval API |
| `START_CREDIT_INR` | Optional, default 49 |

```bash
pnpm install
pnpm dev
```

## Layout

```
app/page.tsx               landing + Google sign-in
app/app/                   the five-step flow with the status bar
app/admin/                 approve UPI recharges
app/api/auth/google/*      sign in / callback / logout
app/api/extract            PDF / DOCX / TXT → text (free)
app/api/{parse,jobs,contact,email,draft}   one paid step each
app/api/recharge           user reports a UPI payment
app/api/admin/recharges    operator lists / approves
lib/ledger.ts              balances (Vercel Blob)
lib/provider.ts            the data backend client
lib/prices.ts              every price the user sees
```

MIT.
