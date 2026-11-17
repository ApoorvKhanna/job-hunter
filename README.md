# Job Hunter

Two ways in, one balance:

- **Job hunt.** Upload a resume. Get matching postings, the people hiring at
  each company, their email, and a short note to send. Pay per step, charged
  only on success.
- **Resume and profile review.** One price. A heatmap of where a recruiter's
  eye lands on the resume in the first seconds, a check of the user's
  LinkedIn, X, GitHub and website against the roles they want, fit and gaps
  per role, rewritten lines and a 7-day plan. Saved to the account.

India pays in rupees (UPI or card), everyone else in US dollars (card), both
through Stripe. An account's currency is fixed at sign-up from the visitor's
country (`x-vercel-ip-country`).

Live: https://thejobhunter.in (the old job-hunter-in.vercel.app address redirects there)

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
- Top-ups are Stripe Checkout over plain REST (no SDK), in the account's
  currency. Payment methods are not listed in code: Checkout shows what the
  Stripe Dashboard enables, so UPI for rupee accounts is a Dashboard toggle
  (Settings, Payment methods, UPI). The webhook and the return page both credit
  through one path that credits each Checkout session once.
- Without Stripe keys, rupee accounts fall back to the old manual UPI flow (pay
  the QR, type the UTR, auto-credit under a daily cap, the rest approved on
  `/admin?token=…`).
- The review: the browser renders the PDF (page images plus every text item's
  position) and nothing leaves it until the user starts. The server groups the
  text into visual lines and charges the price up front. It then runs three
  things in parallel and refunds automatically if the run fails or stalls:
  the eye scan (a vision model looking at the page, falling back to the text
  layout, then to layout rules), the profile reads, and a two-part evaluation.
  Reviews live in `reviews/<sub>/<id>.json` plus page images.

## Prices

In `lib/prices.ts`. Reading a resume is free (10 a day). Dollar prices follow
one fixed ratio, ₹499 = $9, rounded to the cent (deliberately not the market
rate). The review is priced on its own.

| | India | Everyone else |
| --- | --- | --- |
| Welcome credit | ₹45 | $0.81 |
| Read the resume | Free | Free |
| Ten matching postings | ₹49 | $0.88 |
| People at a company | ₹6 | $0.11 |
| Reveal one email | ₹20 | $0.36 |
| Draft the note | ₹2 | $0.04 |
| Resume and profile review | ₹479 | $9 |
| Top-ups | ₹149, ₹499, ₹999 | $5, $10, $20 |

A review costs roughly 10 to 15¢ in backend calls: the model (scan plus
evaluation) and up to 1¢ to 4¢ per profile read.

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
| `STRIPE_SECRET_KEY` | Stripe secret key. Top-ups stay off (rupee accounts fall back to manual UPI) until both Stripe variables are set |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of a webhook endpoint at `<APP_URL>/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded` |
| `REVIEW_MODEL` | Optional. Vision-capable model on the provider's router for the review. Default `anthropic/claude-sonnet-4.5` |
| `GITHUB_TOKEN` | Optional. Lifts GitHub's 60-an-hour unauthenticated limit for profile reads |
| `DEFAULT_CURRENCY` | Optional, `inr` (default) or `usd`: the currency for new accounts when the country is unknown (local dev) |
| `UPI_ID`, `UPI_NAME` | Manual UPI fallback, e.g. `name@upi`. Only shown while Stripe is off |
| `AUTO_CREDIT_INR_PER_DAY` | Manual UPI: instant credit per account per day. Default 99 |
| `ADMIN_TOKEN` | Guards `/admin` and the recharge approval API |
| `VAAYA_CUSTOMERS_ENABLED` | `true` to give every login its own wallet on the backend (see below). Off by default. |
| `VAAYA_OWNER_KEY` | The account's primary, unrestricted key. Only used to create, fund and mint tokens for customers; the backend refuses capped keys there. |
| `CUSTOMER_BUDGET_CENTS`, `CUSTOMER_WELCOME_CENTS` | Per-user spend ceiling and first funding, in US cents. Defaults 500 and 49. |

### Per-user wallets

With `VAAYA_CUSTOMERS_ENABLED=true`, every Google sign-in also ensures a managed
customer on the backend, keyed by the Google subject. The customer id, wallet
address and funding history live on the user's ledger blob. The first paid
contact or jobs-fallback call moves the welcome amount into that wallet, once;
top-ups stay in the app's own ledger and never move money there. Contact search, email reveal
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
app/app/                   after sign-in: choose job hunt or review
app/jobs/                  the five-step job flow with the status bar
app/review/                the review flow, the report, the heatmap
app/saved/                 saved reviews, jobs, contacts and drafts
app/admin/                 money per currency, approve manual UPI
app/credits.tsx            the add-credits sheet (Stripe, or manual UPI)
app/api/auth/google/*      sign in / callback / logout
app/api/extract            PDF / DOCX / TXT → text (free)
app/api/{parse,jobs,contact,email,draft}   one paid step each
app/api/review/*           start (draft), run (charge + run), status, page image
app/api/checkout           opens Stripe Checkout
app/api/stripe/webhook     credits a completed payment
app/api/recharge           manual UPI: user reports a payment
app/api/admin/recharges    operator lists / approves
lib/ledger.ts              balances in the account's currency (Vercel Blob)
lib/stripe.ts              Checkout + webhook verification
lib/review.ts              the review pipeline and its prompts
lib/layout.ts              PDF text → visual lines; fallback scan
lib/profiles.ts            LinkedIn / X / GitHub / site reads
lib/provider.ts            the data backend client
lib/prices.ts              every price the user sees
```

MIT.
