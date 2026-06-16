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
- `knowledge.js` — builds VOLT's system prompt from `../data.js` (the same
  glossary + document list the website renders, so there's one source of truth).
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
