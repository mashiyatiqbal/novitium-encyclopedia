# VOLT Chatbot Backend

A tiny Node/Express server that powers the VOLT AI assistant on the Novitium
Encyclopedia. It serves the static site **and** proxies chat to the Claude API,
keeping your `ANTHROPIC_API_KEY` on the server — the key is never sent to the
browser.

## How it works

```
Browser (app.js)  ──POST /api/chat──▶  Express (server/index.js)  ──▶  Claude API
   VOLT widget     ◀──SSE token stream──   adds system prompt + key      (streaming)
```

- `index.js` — Express app: serves the site from the parent folder and streams
  chat responses over Server-Sent Events.
- `catalogue.js` — assembles the **live** document list, normalizes the type
  labels (`Whitepaper` → `White Paper`), and builds an **author index**: for
  every byline, the exact count and the exact titles behind it.
- `knowledge.js` — builds VOLT's system prompt from that live catalogue plus the
  glossary in `../data.js`.

### Where the catalogue comes from

Two sources, in precedence order — **no configuration is required**:

1. **Server-side Supabase read.** Used when `SUPABASE_SERVICE_ROLE_KEY` is set.
   Cached for `CATALOGUE_TTL_MS`. Not client-controlled, and works even if a
   request arrives with no snapshot.
2. **Client snapshot** (the zero-config default). `documents-loader.js` has
   already read the `documents` table in the browser under the visitor's own
   authenticated session — that is what renders the cards. `app.js` now posts a
   compact copy of that array with each chat message, and the server indexes
   it. The privileged read already happened; nothing here grants a visitor
   access they didn't have.

Client rows are untrusted input: capped at `CATALOGUE_MAX_DOCS`, field lengths
clipped, unknown keys stripped. The worst a tampered snapshot can do is give
that one visitor a wrong answer in their own chat window.

If neither source yields anything, VOLT is told plainly that it cannot see the
library and must not name, count, or attribute any document.

### Why this matters

The browser replaces the placeholder `DOCUMENTS` array in `data.js` with the
real rows from Supabase (`documents-loader.js`). The server used to skip that
step and `require("../data.js")` directly, so VOLT's prompt described twelve
placeholder documents nobody can see on the site — with no author field at all.
Asked "how many papers has X written," VOLT had nothing to read and improvised,
differently each time. Counts and attributions are now computed in JavaScript
and handed to the model as facts; the model is never asked to tally a list, and
requests run at `temperature: 0`.

Two endpoints help when an answer looks wrong:

- `GET /api/catalogue` — exactly what VOLT believes the library contains.
- `POST /api/catalogue/refresh` — drop the cache after publishing or
  re-attributing a document, instead of waiting out the TTL.
- If the backend is unreachable, the front end automatically falls back to the
  built-in rule-based assistant, so the site never breaks.

## Run it locally

Requires Node.js 18+.

```bash
cd server
npm install
cp .env.example .env        # then edit .env and paste your ANTHROPIC_API_KEY
npm start
```

Open http://localhost:3000 — the full site loads and VOLT now answers with
Claude. Check http://localhost:3000/api/health to confirm the key is detected.

## Configuration (`.env`)

| Variable            | Default            | Notes                                            |
| ------------------- | ------------------ | ------------------------------------------------ |
| `ANTHROPIC_API_KEY` | — (required)       | Your key from console.anthropic.com.             |
| `SUPABASE_URL`      | project URL        | Same project the site uses.                      |
| `SUPABASE_SERVICE_ROLE_KEY` | — (optional) | Enables the server-side catalogue read. Without it VOLT uses the browser snapshot. `documents` is RLS-gated, so the publishable key returns `[]` — this must be a service_role key, and server-side only. |
| `CATALOGUE_TTL_MS`  | `300000`           | How long to cache the server-side document list.  |
| `CATALOGUE_MAX_DOCS`| `500`              | Cap on rows accepted from a client snapshot.      |
| `CHAT_MODEL`        | `claude-opus-4-8`  | Set to `claude-haiku-4-5` or `claude-sonnet-4-6` to cut cost. |
| `PORT`              | `3000`             | Port to listen on.                               |

## Deploying to energyglossary.com

This server is a standard Node app — deploy it to any Node host
(Render, Railway, Fly.io, a VPS, etc.):

1. Push the `novitium-encyclopedia/` folder to your host.
2. Set the start command to `node server/index.js` (or `cd server && npm start`).
3. Add `ANTHROPIC_API_KEY` as an environment variable in the host's dashboard
   (never commit `.env`).
4. Point energyglossary.com's DNS at the host and enable HTTPS.

The server serves both the site and the API on one origin, so no CORS or extra
config is needed.

> Prefer a static host (Netlify/Vercel/S3)? You can host the site statically and
> run just the chat endpoint as a serverless function instead. The browser only
> needs `POST /api/chat` to return the same SSE stream. Ask and this can be
> packaged as a Vercel/Netlify function.

## Cost & safety notes

- `max_tokens` is capped at 1024 and history is trimmed to the last 20 turns to
  bound per-message cost. The system prompt is cached (`cache_control`) so
  repeated requests are cheaper.
- VOLT is instructed to stay on clean-energy/site topics, only reference
  documents that exist, and decline to give personalized financial/tax/legal
  advice. Review `knowledge.js` to adjust its persona or guardrails.
