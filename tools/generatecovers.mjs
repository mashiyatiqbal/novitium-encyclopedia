#!/usr/bin/env node
/* ============================================================
   Novitium Encyclopedia — cover thumbnail generator

   Renders page 1 of every document in the private "documents"
   bucket into a small JPEG in the public "covers" bucket, then
   writes cover_path back onto the row so the library cards can
   show the real cover instead of the generated placeholder.

   WHY THIS RUNS HERE AND NOT IN A SUPABASE EDGE FUNCTION
   ------------------------------------------------------
   The library holds Word and PowerPoint files as well as PDFs.
   Turning those into a picture needs LibreOffice, which cannot
   run inside Deno/Edge. A GitHub Actions runner has LibreOffice
   and Poppler available and is free for public repositories, so
   the conversion happens there. See .github/workflows/covers.yml.

   NO NPM DEPENDENCIES — plain fetch (Node 18+) against the
   Supabase REST and Storage APIs, plus two command-line tools:

     pdftoppm   (poppler-utils)  PDF page -> JPEG
     soffice    (libreoffice)    docx/pptx -> PDF

   USAGE
   -----
     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
       node tools/generate-covers.mjs [options]

     --force        regenerate covers that already exist
     --only <text>  only rows whose title or storage_path contains <text>
     --limit <n>    stop after n documents (default 50)
     --dry-run      report what would happen, touch nothing
     --list         just print the catalogue and its cover status

   The service-role key is a full-access credential. It belongs in
   a GitHub Actions secret or a local .env — never in the site.
   ============================================================ */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/* ---------------------------------------------------------- config */

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";

const DOC_BUCKET = process.env.COVERS_SOURCE_BUCKET || "documents";
const COVER_BUCKET = process.env.COVERS_BUCKET || "covers";

/* 800px wide covers the largest card slot on a 2x display. Quality 85 keeps
   a text-heavy title page readable at roughly 60-120 KB, which matters on
   the Supabase free tier (1 GB storage, 5 GB egress a month). */
const COVER_WIDTH = Number(process.env.COVER_WIDTH || 800);
const JPEG_QUALITY = Number(process.env.COVER_QUALITY || 85);

const CONVERT_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 60_000;

/* Extensions we can turn into a picture. Everything else keeps the
   generated placeholder — there is no meaningful "cover page" for a
   spreadsheet or a YouTube link. */
const PDF_EXT = new Set([".pdf"]);
const OFFICE_EXT = new Set([
  ".docx", ".doc", ".dotx", ".rtf", ".odt",
  ".pptx", ".ppt", ".potx", ".odp",
]);

/* ------------------------------------------------------------ args */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const OPTS = {
  force: flag("--force"),
  dryRun: flag("--dry-run"),
  list: flag("--list"),
  only: value("--only", ""),
  limit: Number(value("--limit", 50)),
};

/* --------------------------------------------------------- logging */

const t0 = Date.now();
const log = (...a) => console.log(...a);
const warn = (...a) => console.warn("  !", ...a);
const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

/* ----------------------------------------------------- supabase io */

function authHeaders(extra) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    ...extra,
  };
}

/* Rows are addressed by their uuid primary key, never by storage_path.
   An earlier version filtered on storage_path and wrapped the value in
   double quotes before percent-encoding it; PostgREST read those quotes as
   part of the value, so "Direct Pay White Paper (1).pdf" matched nothing.
   A PATCH that matches no rows is still a successful PATCH, so every cover
   uploaded correctly while every row silently kept cover_path = NULL.
   A uuid has no characters that need quoting at all, which removes the
   entire class of bug. saveCoverPath() also now verifies the row count. */

async function listDocuments() {
  const url =
    `${SUPABASE_URL}/rest/v1/documents` +
    `?select=id,title,storage_path,cover_path,type,published_on` +
    `&order=published_on.desc`;

  const res = await fetch(url, { headers: authHeaders({ Accept: "application/json" }) });
  if (!res.ok) {
    throw new Error(`documents read failed: ${res.status} ${await res.text()}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("unexpected documents payload");
  return rows;
}

async function downloadDocument(storagePath) {
  const url =
    `${SUPABASE_URL}/storage/v1/object/${DOC_BUCKET}/` +
    storagePath.split("/").map(encodeURIComponent).join("/");

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function uploadCover(coverPath, jpeg) {
  const url =
    `${SUPABASE_URL}/storage/v1/object/${COVER_BUCKET}/` +
    coverPath.split("/").map(encodeURIComponent).join("/");

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders({
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "x-upsert": "true", // re-running the job replaces the old cover
    }),
    body: jpeg,
  });
  if (!res.ok) {
    throw new Error(`cover upload failed: ${res.status} ${await res.text()}`);
  }
}

async function saveCoverPath(id, coverPath) {
  if (!/^[0-9a-fA-F-]{36}$/.test(String(id))) {
    throw new Error(`refusing to patch: "${id}" is not a uuid`);
  }

  const url = `${SUPABASE_URL}/rest/v1/documents?id=eq.${encodeURIComponent(id)}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: authHeaders({
      "Content-Type": "application/json",
      /* return=representation, NOT return=minimal. PostgREST answers a PATCH
         that matched zero rows with a perfectly successful 2xx, so "did the
         write land?" cannot be read from the status code. Asking for the
         changed rows back is the only way to know. */
      Prefer: "return=representation",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      cover_path: coverPath,
      cover_updated_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    throw new Error(`row update failed: ${res.status} ${await res.text()}`);
  }

  const updated = await res.json().catch(() => null);
  if (!Array.isArray(updated) || updated.length === 0) {
    throw new Error(
      `row update matched no rows for id ${id} — cover uploaded but the ` +
        `catalogue still points at nothing`
    );
  }
  if (updated[0].cover_path !== coverPath) {
    throw new Error(
      `row update did not stick: expected cover_path "${coverPath}", ` +
        `got "${updated[0].cover_path}"`
    );
  }
}

/* ------------------------------------------------------- rendering */

/* Mirror the document's own path so the mapping is obvious in the dashboard
   and stable across runs: "guides/interconnection v1.2.pdf" becomes
   "guides/interconnection-v1-2.jpg". Storage keys are happiest with plain
   ASCII, so anything else collapses to a hyphen. */
function coverPathFor(storagePath) {
  const dir = path.posix.dirname(storagePath);
  const base = path.posix.basename(storagePath, path.posix.extname(storagePath));
  const slug =
    base
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "document";
  return (dir && dir !== "." ? dir + "/" : "") + slug + ".jpg";
}

/* LibreOffice needs a writable profile directory. Without an explicit one it
   tries $HOME and dies on a fresh CI runner, or worse, silently reuses a
   half-written profile from a previous document in the same run. */
async function officeToPdf(inputFile, workDir) {
  const profile = path.join(workDir, "lo-profile");
  await run(
    "soffice",
    [
      `-env:UserInstallation=file://${profile}`,
      "--headless",
      "--norestore",
      "--invisible",
      "--convert-to", "pdf",
      "--outdir", workDir,
      inputFile,
    ],
    { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 1 << 24 }
  );

  const produced = (await readdir(workDir)).find((f) => f.toLowerCase().endsWith(".pdf"));
  if (!produced) throw new Error("LibreOffice produced no PDF");
  return path.join(workDir, produced);
}

/* -singlefile writes exactly "<prefix>.jpg" instead of the page-numbered
   "out-01.jpg" / "out-1.jpg" whose padding depends on the page count. */
async function pdfPageOneToJpeg(pdfFile, workDir) {
  const prefix = path.join(workDir, "cover");
  await run(
    "pdftoppm",
    [
      "-jpeg",
      "-jpegopt", `quality=${JPEG_QUALITY},optimize=y,progressive=y`,
      "-f", "1", "-l", "1",
      "-singlefile",
      "-scale-to-x", String(COVER_WIDTH),
      "-scale-to-y", "-1", // -1 keeps the page's own aspect ratio
      pdfFile,
      prefix,
    ],
    { timeout: RENDER_TIMEOUT_MS, maxBuffer: 1 << 24 }
  );
  return readFile(prefix + ".jpg");
}

async function renderCover(fileBuffer, storagePath) {
  const ext = path.posix.extname(storagePath).toLowerCase();
  const workDir = await mkdtemp(path.join(tmpdir(), "cover-"));
  try {
    const source = path.join(workDir, "input" + (ext || ".bin"));
    await writeFile(source, fileBuffer);

    const pdf = PDF_EXT.has(ext) ? source : await officeToPdf(source, workDir);
    return await pdfPageOneToJpeg(pdf, workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------ main */

function isRenderable(storagePath) {
  const ext = path.posix.extname(storagePath || "").toLowerCase();
  return PDF_EXT.has(ext) || OFFICE_EXT.has(ext);
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
        "Locally: export them in your shell. In CI: repository secrets."
    );
    process.exit(1);
  }

  const rows = await listDocuments();
  log(`Catalogue: ${rows.length} documents (${secs()})`);

  if (OPTS.list) {
    rows.forEach((r) => {
      const state = r.cover_path
        ? "cover"
        : !r.storage_path
        ? "external"
        : isRenderable(r.storage_path)
        ? "PENDING"
        : "unsupported";
      log(`  [${state.padEnd(11)}] ${r.title}  ${r.storage_path || r.type || ""}`);
    });
    return;
  }

  const needle = OPTS.only.toLowerCase();
  const queue = rows.filter((r) => {
    if (!r.storage_path) return false;               // external video / link
    if (!isRenderable(r.storage_path)) return false; // xlsx, images, ...
    if (r.cover_path && !OPTS.force) return false;   // already done
    if (needle) {
      const hay = `${r.title || ""} ${r.storage_path}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const skippedUnsupported = rows.filter(
    (r) => r.storage_path && !isRenderable(r.storage_path)
  ).length;

  log(
    `To render: ${queue.length}` +
      (queue.length > OPTS.limit ? ` (capped at ${OPTS.limit} this run)` : "") +
      (skippedUnsupported ? ` · ${skippedUnsupported} unsupported file type(s)` : "")
  );

  if (!queue.length) {
    log("Nothing to do — every document already has a cover.");
    return;
  }

  const batch = queue.slice(0, OPTS.limit);
  let done = 0;
  const failures = [];

  for (const row of batch) {
    const coverPath = coverPathFor(row.storage_path);
    log(`\n• ${row.title}`);
    log(`  ${row.storage_path}  ->  ${COVER_BUCKET}/${coverPath}`);

    if (OPTS.dryRun) {
      log("  (dry run — skipped)");
      continue;
    }

    try {
      const file = await downloadDocument(row.storage_path);
      const jpeg = await renderCover(file, row.storage_path);
      await uploadCover(coverPath, jpeg);
      await saveCoverPath(row.id, coverPath);
      done += 1;
      log(`  ✓ ${(jpeg.length / 1024).toFixed(0)} KB (${secs()})`);
    } catch (err) {
      failures.push({ title: row.title, message: err.message });
      warn(err.message);
    }
  }

  log(`\nDone in ${secs()} — ${done} cover(s) written, ${failures.length} failed.`);

  /* A failed cover is cosmetic: that card keeps its placeholder and the next
     run retries it. Exit non-zero anyway so a broken file shows up as a red
     run in the Actions tab rather than passing quietly forever. */
  if (failures.length) {
    failures.forEach((f) => console.error(`FAILED  ${f.title}: ${f.message}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
