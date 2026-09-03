# Document cover thumbnails

Library cards show **page 1 of the document itself** instead of the generated
gradient placeholder. Covers are rendered once, stored as small JPEGs, and
served as ordinary cached images.

Everything here runs on free tiers: GitHub Actions minutes are unlimited on a
public repository, and a cover costs ~20–120 KB of Supabase storage.

## One-time setup

**1. Database + bucket** — open the Supabase dashboard → SQL Editor → New
query, paste [`covers-setup.sql`](./covers-setup.sql), Run. It adds
`documents.cover_path` / `cover_updated_at` and creates a **public** `covers`
bucket.

**2. Repository secrets** — GitHub → Settings → Secrets and variables →
Actions → New repository secret:

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | `https://mizlazbsufftjtlvdrjv.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key |

The service-role key bypasses RLS. It only ever exists as an Actions secret —
never in `auth.js` or anything else the browser downloads.

**3. Backfill the existing library** — GitHub → Actions → **Document covers**
→ Run workflow. Every document that already has a file gets a cover.

## Day to day

Upload the document to the `documents` bucket and add its row as you do now.
The cover appears on its own:

- **Automatically**, within the hour (the workflow runs at :17 past).
- **Immediately**, if you don't want to wait: Actions → Document covers → Run
  workflow.

Until the cover exists the card shows the current generated placeholder, so a
new document never looks broken while it waits.

## What gets a cover

| Uploaded file | Result |
| --- | --- |
| `.pdf` | page 1 rendered directly |
| `.docx` `.doc` `.rtf` `.odt` | LibreOffice → PDF → page 1 |
| `.pptx` `.ppt` `.potx` `.odp` | slide 1 |
| `.xlsx`, images, anything else | placeholder (no meaningful cover page) |
| external link / video (`external_url`) | placeholder |

## Replacing a document

Overwrite the file in the bucket, then run the workflow with **force** ticked
(or `--force` locally). The cover is written to the same path, and
`cover_updated_at` is appended to the image URL as `?v=…`, so browsers pick up
the new cover instead of serving the year-cached old one.

## Running it locally

```bash
export SUPABASE_URL=https://mizlazbsufftjtlvdrjv.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...        # keep out of git

node tools/generate-covers.mjs --list       # what has a cover, what's pending
node tools/generate-covers.mjs --dry-run    # plan only, writes nothing
node tools/generate-covers.mjs              # do the pending ones
node tools/generate-covers.mjs --force --only "interconnection"
```

Needs `pdftoppm` (poppler-utils) and `soffice` (LibreOffice) on your PATH, plus
Node 18+. No npm install — the script uses built-in `fetch` only.

## Design notes

**Why the `covers` bucket is public while `documents` stays private.** A cover
is a picture of a title page, not the document. Public means the grid loads
plain `<img>` tags that the browser and CDN cache, instead of minting a signed
URL per card on every page view. The documents themselves keep their private
bucket and 5-minute signed URLs, unchanged. If a particular cover page is
confidential, clear that row's `cover_path` and it falls back to the
placeholder.

**Why GitHub Actions and not a Supabase Edge Function.** Edge Functions run on
Deno, which cannot run LibreOffice — so a `.docx` or `.pptx` could never be
turned into an image there. Actions runners have both LibreOffice and Poppler.

**Why the cards never break.** `app.js` adds `.has-cover` only when the row has
a `cover_path`, and the `<img>`'s `onerror` removes it again if the file is
missing. Any failure — cover not generated yet, file deleted, unsupported type
— lands on the original placeholder. A failed render also exits the workflow
non-zero so it shows up red in the Actions tab, and the next run retries it.

**Cover size.** 800px wide at JPEG quality 85 (~20–120 KB), which covers the
widest card slot on a 2× display. Tune with the `COVER_WIDTH` and
`COVER_QUALITY` environment variables.

## Optional: instant covers

If waiting up to an hour bothers you, Supabase can poke GitHub the moment a row
is inserted: Database → Webhooks → new webhook on `documents` INSERT → HTTP
POST to

```
https://api.github.com/repos/mashiyatiqbal/novitium-encyclopedia/actions/workflows/covers.yml/dispatches
```

with headers `Authorization: Bearer <GitHub PAT with actions:write>`,
`Accept: application/vnd.github+json`, and body `{"ref":"main"}`. Also free, but
it means storing a GitHub token in Supabase — the hourly schedule avoids that,
which is why it's the default.
