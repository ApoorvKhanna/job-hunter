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
- Jobs come from a two-source cascade. JSearch (OpenWeb Ninja on RapidAPI,
  Google Jobs underneath) runs first at roughly 1/100th the per-job cost. If
  it returns fewer than 10 fresh matches, TheirStack tops the page up inside
  the same date window, so the deeper India coverage stays available and the
  flat per-call fee is only paid on a miss. Without `RAPIDAPI_KEY` the app
  runs on TheirStack alone. Contacts and drafting run through a metered
  backend behind one operator key. The user never sees either backend.
- Every search logs per-source counts (`[jobs] {"jsearch":7,"theirstack":4,…}`),
  which is the raw data for comparing source depth on identical queries.
- Note on coverage: JSearch does not reliably index naukri.com. If naukri
  turns out to carry a real share of Indian matches, the fix is a
  naukri-specific source or keeping TheirStack for India queries. An Indeed
  scraper does not close that gap; it is a different pool of employers. Prices in `lib/prices.ts`
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
| `PROVIDER_API_KEY` | The operator's data-backend key (contacts, drafting, and the jobs fallback) |
| `JSEARCH_API_KEY` | OpenWeb Ninja direct API key (`ak_…`) for JSearch. Set it and jobs switch to the cheap source. |
| `SESSION_SECRET` | 32+ random characters |
| `APP_URL` | `https://<host>`, no trailing slash |
| `BLOB_READ_WRITE_TOKEN` | From the connected Vercel Blob store |
| `UPI_ID`, `UPI_NAME` | Where recharges go, e.g. `name@upi` |
| `ADMIN_TOKEN` | Guards `/admin` and the recharge approval API |
| `START_CREDIT_INR` | Optional, default 49 |
| `VAAYA_CUSTOMERS_ENABLED` | `true` to give every login its own wallet on the backend (see below). Off by default. |
| `VAAYA_OWNER_KEY` | The account's primary, unrestricted key. Only used to create, fund and mint tokens for customers; the backend refuses capped keys there. |
| `CUSTOMER_BUDGET_CENTS`, `CUSTOMER_WELCOME_CENTS` | Per-user spend ceiling and first funding, in US cents. Defaults 500 and 49. |

### Per-user wallets

With `VAAYA_CUSTOMERS_ENABLED=true`, every Google sign-in also ensures a managed
customer on the backend, keyed by the Google subject. The customer id, wallet
address and funding history live on the user's ledger blob. The first paid
contact or jobs-fallback call moves the welcome amount into that wallet, and an
approved UPI recharge mirrors into it at ₹1 ≈ 1¢. Contact search, email reveal
and the TheirStack top-up then settle from the user's own wallet with a fresh
`Idempotency-Key` per attempt. Resume parsing, drafting and the first contact
rung stay on the operator key because the backend cannot settle those per
customer. Any customer-side failure (feature off upstream, wallet still
provisioning, unfunded, paused, over budget, expired token) falls back to the
operator key for that call and is logged as `[customer] fell back`. A user is
never blocked by wallet plumbing.

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
