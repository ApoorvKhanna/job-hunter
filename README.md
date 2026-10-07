# Job Hunter

Upload a resume. Get fresh job postings that fit, the people hiring at each
company, their email, and a short note to send. One run costs $2.50 and is
charged only when the search finds jobs.

Hosted version, nothing to set up: https://vaaya.ai/job-hunter

**Running your own copy is not free.** Every backend call (reading the resume,
job search, contact and email lookups, drafting) is billed to your own
[Vaaya](https://vaaya.ai) API key at Vaaya's per-call prices, so that key needs
a balance. Job search can use a separate key instead: set `JSEARCH_API_KEY` and
those calls go to OpenWeb Ninja and are billed by them.

## Pricing

What your users pay. The numbers live in `lib/prices.ts`.

| What | Price |
| --- | --- |
| Reading a resume | Free, up to 10 a day per account |
| One run: a job search with up to 10 postings | $2.50, charged only if at least one job comes back |
| Inside a run | Contacts at up to 3 companies, up to 3 email lookups, up to 15 drafts or rewrites |

A lookup that comes back empty does not count toward these, though a run
allows at most 5 contact tries, 5 email tries and 18 draft tries. Users add
funds by card through your Stripe account ($5, $10 or $25).

## Setup

### 1. Install

```bash
git clone https://github.com/ApoorvKhanna/job-hunter.git
cd job-hunter
pnpm install
cp .env.example .env.local
```

### 2. Configure

Fill in `.env.local` (and the same variables on your host when you deploy).

| Name | Required | What |
| --- | --- | --- |
| `VAAYA_API_KEY` | Yes | Your Vaaya API key, with balance. Pays for every backend call |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Yes | A Google OAuth web client. Redirect URI: `<APP_URL>/api/auth/google/callback` |
| `SESSION_SECRET` | Yes | 32 or more random characters, e.g. `openssl rand -hex 32` |
| `APP_URL` | Yes | Where the app runs, no trailing slash: `http://localhost:3000` locally |
| `BLOB_READ_WRITE_TOKEN` | Yes | Read-write token of a **private** Vercel Blob store. Balances, runs and saved results all live there |
| `STRIPE_SECRET_KEY` | For top-ups | Your Stripe secret key. Top-ups stay off until both Stripe variables are set |
| `STRIPE_WEBHOOK_SECRET` | For top-ups | Signing secret of a Stripe webhook endpoint at `<APP_URL>/api/stripe/webhook`, listening to `checkout.session.completed` and `checkout.session.async_payment_succeeded` |
| `JSEARCH_API_KEY` | No | Your OpenWeb Ninja key (`ak_…`) for JSearch's direct API. Unset, job search goes through Vaaya on `VAAYA_API_KEY` |
| `ADMIN_TOKEN` | No | Opens `/admin?token=…` and the admin API |
| `START_CREDIT_CENTS` | No | Credit each new account starts with, in US cents. Default 0 |
| `PARSES_PER_DAY` | No | Free resume reads per account per day. Default 10 |
| `EMPTY_SEARCHES_PER_DAY` | No | Searches that find nothing, per account per day. Default 10 |
| `IP_GATE` | No | `credit` (default): a second account from the same network gets no welcome credit. `block`: it is turned away. `off` |
| `VAAYA_URL` | No | Default `https://vaaya.ai` |
| `VAAYA_CUSTOMERS_ENABLED`, `VAAYA_OWNER_KEY`, `CUSTOMER_BUDGET_CENTS`, `CUSTOMER_WELCOME_CENTS` | No | Per-user wallets, off by default. See below |

### 3. Run

```bash
pnpm dev
```

Open http://localhost:3000 and sign in with Google. If a required variable is
missing, the page names it. To try a top-up locally,
use a Stripe test key and forward webhooks with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

It prints the `whsec_…` secret to use as `STRIPE_WEBHOOK_SECRET`. The page you
return to after paying also credits the payment, so the balance updates even
before the webhook arrives.

### 4. Deploy

Import the repo on Vercel. Create a Blob store with access set to **Private**
(the app reads and writes private blobs, and a store's access cannot be changed
later), connect it to the project, and copy its read-write token into
`BLOB_READ_WRITE_TOKEN`. Add the other variables and deploy. Then add
`<APP_URL>/api/auth/google/callback` to the Google client's redirect URIs and
create the Stripe webhook endpoint for your domain.

## What it costs you to run

- **Vaaya**: every resume read, people search, email lookup and draft is a paid
  call on `VAAYA_API_KEY`, and so is job search unless `JSEARCH_API_KEY` is set.
  Free resume reads and searches that find nothing still make those calls;
  `PARSES_PER_DAY`, `EMPTY_SEARCHES_PER_DAY` and the per-run allowance cap how
  many each user can make.
- **OpenWeb Ninja**, if you set `JSEARCH_API_KEY`: their JSearch pricing.
- **Stripe**: their fees on each top-up. Refunds are issued in Stripe; the app
  does not take the balance back on its own.
- **Vercel**: hosting and Blob usage.

## How it is built

- Next.js 15, no database server. Each user's balance is one private JSON blob
  in Vercel Blob (`users/<google-sub>.json`), in US cents, written with
  optimistic ETag checks. Each run is its own blob
  (`runs/<google-sub>/<run-id>.json`) holding its jobs, the contacts and
  emails it found, and its allowance counters.
- Sign in with Google (plain OAuth 2.0, no auth library). Identity lives in one
  AES-GCM encrypted cookie.
- A run starts with a job search. The balance must cover $2.50 before the
  search; the debit happens only when at least one posting comes back. Every
  later step checks its input against the run, so a lookup can only target a
  job or a person that run produced. A lookup spends a "try" before the call
  and a "use" only when it returns something; a backend error hands the try
  back. Contacts are kept per company, so a second posting at the same company
  is free.
- Jobs come from JSearch (OpenWeb Ninja, Google Jobs underneath): the user's
  date window first, a wider date bucket when results are thin, then 30 days
  and any country before giving up. Naming the country inside the query text
  keeps results fresh and spread out.
- Contacts: Vaaya's people finder first, then a ContactOut people search when
  it finds fewer than two people. Emails: ContactOut. Resume reading and
  drafts: Vaaya's OpenAI-compatible model endpoint. The app's UI never names
  the backend.
- Card top-ups use Stripe Checkout over plain REST (no SDK). The webhook and
  the return page both credit through one path that credits each Checkout
  session once.
- Abuse controls: one welcome credit per network (`IP_GATE`), and operator
  blocks for an account or its network (`POST /api/admin/block`).

### Per-user wallets (optional)

With `VAAYA_CUSTOMERS_ENABLED=true`, every Google sign-in also gets its own
managed customer on Vaaya, keyed by the Google subject, with its own wallet.
Before a user's first wallet-settled call, `VAAYA_OWNER_KEY` (your account's
primary, unrestricted key) moves `CUSTOMER_WELCOME_CENTS` from your Vaaya
balance into that wallet, once. It is not refilled: after it is spent, calls
settle on `VAAYA_API_KEY`. `CUSTOMER_BUDGET_CENTS` is the lifetime cap Vaaya
enforces on the wallet.
Job search through Vaaya, people search and email lookups then settle from the
user's own wallet, so spend is attributed per person. Resume reading, drafting
and the first contact rung stay on `VAAYA_API_KEY`. Any wallet-side failure
falls back to `VAAYA_API_KEY` for that call, so a user is never blocked by
wallet plumbing. It is still your money either way.

## Layout

```
app/page.tsx               landing + Google sign-in
app/app/                   the five-step flow with the status bar
app/saved/                 saved jobs, contacts and drafts
app/admin/                 accounts and money totals
app/add-funds.tsx          the card top-up sheet
app/api/auth/google/*      sign in / callback
app/api/auth/logout        sign out
app/api/extract            PDF / DOCX / TXT → text (free)
app/api/parse              resume → search profile (free, capped per day)
app/api/jobs               starts a run: the paid search
app/api/{contact,email,draft}   steps inside a run
app/api/checkout           opens Stripe Checkout
app/api/stripe/webhook     credits a completed payment
app/api/admin/*            accounts, blocks, wallet labels
lib/prices.ts              the run price, its allowance, top-up amounts
lib/ledger.ts              balances (Vercel Blob)
lib/runs.ts                runs and their allowance
lib/provider.ts            the Vaaya client
lib/jsearch.ts             job search
lib/stripe.ts              Checkout + webhook verification
```

## License

MIT. See [LICENSE](LICENSE).
