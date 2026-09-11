# Job Hunt Agent

Paste your resume. It pulls matching postings from TheirStack, finds the
engineering manager or recruiter at each company via ContactOut, reveals
their email, and drafts a 120-word note. Every step is priced before you
click it.

**It has no API key of its own.** Each user signs in with Vaaya OAuth and
every call runs on that user's own Vaaya credit. The app stores nothing: the
user's tokens sit in one AES-GCM encrypted httpOnly cookie.

Live: https://jobhunt-agent.vercel.app

## How it works

| Step | Vaaya call | Price |
| --- | --- | --- |
| Read the resume | `POST /api/llm/v1/chat/completions` (Claude Haiku 4.5) | under 1¢ |
| Ten matching postings | `theirstack/jobs` with `limit: 10` | 40¢ flat |
| Three people to write to | `contactout/people-search` with `page_size: 3` | 3¢ |
| Reveal one email | `contactout/linkedin-contacts` | 10¢ |
| Draft the note | LLM router again | under 1¢ |

A full round on one company is about 55¢. New Vaaya accounts start with a
welcome credit, so a first round is free for the user.

## Auth

Vaaya is a standard OAuth 2.1 authorization server with PKCE and dynamic
client registration (`https://vaaya.ai/.well-known/oauth-authorization-server`).
The app is a public client (`token_endpoint_auth_method: none`). A user who
is not signed in to Vaaya is bounced through signup and returned to the
consent screen, so a new visitor becomes a new Vaaya account in one flow.

Access tokens live 12 hours, refresh tokens 60 days. `lib/vaaya.ts` refreshes
on a 401 and the route wrapper re-sets the cookie.

## Run it yourself

1. Register a client once (it is idempotent for the same name + redirect):

   ```bash
   curl -s https://vaaya.ai/oauth/register -H 'content-type: application/json' -d '{
     "client_name": "Job Hunt Agent",
     "client_uri": "https://YOUR-HOST",
     "redirect_uris": ["https://YOUR-HOST/api/auth/callback"],
     "scope": "vaaya:pay vaaya:read"
   }'
   ```

   Redirect URIs must be `https` (or `http://127.0.0.1:PORT` for local dev).

2. Set env: `VAAYA_CLIENT_ID`, `APP_URL` (no trailing slash), `SESSION_SECRET`
   (32+ random chars). Optional `VAAYA_ISSUER` for previews.

3. `pnpm install && pnpm dev`. For local dev register a second client with
   `http://127.0.0.1:3000/api/auth/callback` and set `APP_URL` to match.

## Claude Code skill

`skill/SKILL.md` runs the same flow from a terminal through the Vaaya MCP
server. Copy it into `~/.claude/skills/jobhunt/` and say "hunt jobs for me
with this resume".

## Layout

```
app/page.tsx              landing + sign in
app/hunt/                 the flow (client component)
app/api/auth/*            OAuth start / callback / logout
app/api/{parse,jobs,contact,email,draft}   one Vaaya call each
lib/vaaya.ts              the only file that talks to Vaaya
lib/session.ts            encrypted cookie
lib/prices.ts             every price shown in the UI
```

MIT.
