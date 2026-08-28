// Novitium Encyclopedia — live document catalogue for VOLT
//
// WHY THIS FILE EXISTS
// -------------------
// The website reads its documents from Supabase at runtime (documents-loader.js
// empties the placeholder DOCUMENTS array in data.js and refills it from the
// `documents` table). The VOLT backend never did that: knowledge.js required
// ../data.js directly, so VOLT's system prompt described 12 placeholder rows
// that nobody can see on the site, with no author field at all.
//
// That is why VOLT gave a different answer every time it was asked "how many
// papers has <author> written" — it had no author data, so it improvised.
//
// This module gives the server the same catalogue the browser sees, plus a
// precomputed author index so counts and attributions are arithmetic rather
// than guesswork.
//
// TWO WAYS IN
// -----------
// 1. Server-side read (preferred). If SUPABASE_SERVICE_ROLE_KEY is set, the
//    server reads the `documents` table itself and caches the result.
// 2. Client snapshot (fallback, needs no key). The browser has already read
//    the table under the visitor's own authenticated session — that is what
//    renders the cards. app.js posts a compact copy alongside each chat
//    message and we index that instead. The privileged read already happened;
//    nothing here grants access the visitor didn't have.
//
// Client rows are untrusted input: capped, trimmed, and stripped to a known
// field list below. Worst case a visitor corrupts their own chat session.

const crypto = require("crypto");

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://mizlazbsufftjtlvdrjv.supabase.co";

// Reading `documents` is gated by RLS (the anon/publishable key returns []),
// so the server needs a key that can read the table. A service-role key is
// the usual choice. Keep it in .env — never in the front-end bundle.
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";

const TTL_MS = Number(process.env.CATALOGUE_TTL_MS || 5 * 60 * 1000);

// True when the server can read Supabase itself. When false we rely entirely
// on the snapshot the browser sends.
const SERVER_READ_ENABLED = !!SUPABASE_KEY;

/* ------------------------------------------------- untrusted-input limits */

const MAX_DOCS = Number(process.env.CATALOGUE_MAX_DOCS || 500);
const MAX_TAGS = 12;
const FIELD_LIMITS = {
  title: 300,
  summary: 1000,
  category: 120,
  type: 120,
  level: 60,
  date: 40,
  readTime: 60,
  author: 200,
  tag: 60,
};

/* ---------------------------------------------------------------- helpers */

// data.js says "Whitepaper", the Document Type filter says "White Paper".
// Normalize so counts and filters agree.
const TYPE_ALIASES = {
  whitepaper: "White Paper",
  "white paper": "White Paper",
  guide: "Guide",
  "case study": "Case Study",
  video: "Video",
  template: "Template",
  "spec sheet": "Spec Sheet",
};

function normalizeType(t) {
  const key = String(t || "").trim().toLowerCase();
  return TYPE_ALIASES[key] || (t ? String(t).trim() : "Document");
}

function cleanName(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Lowercase, strip accents and punctuation — used for matching a visitor's
// "Wissam" against the stored byline "Wissam Kassem".
function foldName(s) {
  return cleanName(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Suffixes and honorifics that are not part of a searchable name.
const NAME_NOISE = new Set([
  "dr", "mr", "mrs", "ms", "prof", "pe", "phd", "jr", "sr", "ii", "iii", "esq",
]);

function nameTokens(byline) {
  return foldName(byline)
    .split(" ")
    .filter((tok) => tok.length > 1 && !NAME_NOISE.has(tok));
}

/* --------------------------------------------------------- normalization */

function clip(value, limit) {
  return cleanName(value).slice(0, limit);
}

function mapRow(r) {
  return {
    title: clip(r.title, FIELD_LIMITS.title) || "Untitled",
    summary: clip(r.summary, FIELD_LIMITS.summary),
    category: clip(r.category, FIELD_LIMITS.category),
    type: normalizeType(clip(r.type, FIELD_LIMITS.type)),
    level: clip(r.level, FIELD_LIMITS.level),
    date: clip(r.published_on || r.date, FIELD_LIMITS.date),
    readTime: clip(r.read_time || r.readTime, FIELD_LIMITS.readTime),
    author: clip(r.author, FIELD_LIMITS.author) || "Unattributed",
    tags: Array.isArray(r.tags)
      ? r.tags
          .slice(0, MAX_TAGS)
          .map((t) => clip(t, FIELD_LIMITS.tag))
          .filter(Boolean)
      : [],
  };
}

/**
 * Turn whatever the browser posted into rows we're willing to put in a prompt.
 * Anything that isn't a plain object is dropped; every field is re-derived
 * through mapRow, so unknown keys never survive.
 */
function sanitizeClientRows(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === "object" && !Array.isArray(r))
    .slice(0, MAX_DOCS)
    .map(mapRow)
    .filter((d) => d.title && d.title !== "Untitled");
}

/* --------------------------------------------------------- fingerprinting */

// The system prompt is prompt-cached, so it must be byte-identical between
// requests whenever the library hasn't changed. A wall-clock timestamp in the
// prompt would break the cache on every single request. This fingerprint
// changes only when the content does.
function fingerprint(docs) {
  const canonical = docs
    .map((d) => [d.title, d.author, d.type, d.category, d.level, d.date].join("|"))
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

// Deterministic order: newest first, ties broken by title. Two visitors with
// the same library produce the same prompt, so they share the cache.
function sortDocs(docs) {
  return [...docs].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.title.localeCompare(b.title);
  });
}

function buildCatalogue(rawDocs, source) {
  const docs = sortDocs(rawDocs);
  return {
    available: docs.length > 0,
    source,
    docs,
    authors: buildAuthorIndex(docs),
    version: fingerprint(docs),
    fetchedAt: new Date().toISOString(),
    error: null,
  };
}

/* -------------------------------------------------------- author indexing */

// One entry per distinct byline, with the exact titles behind it. Counts are
// computed here, in code — the model is never asked to count anything.
function buildAuthorIndex(docs) {
  const byKey = new Map();

  docs.forEach((d) => {
    const key = foldName(d.author);
    if (!key) return;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        name: d.author,
        tokens: nameTokens(d.author),
        total: 0,
        byType: {},
        titles: [],
      });
    }
    const entry = byKey.get(key);
    entry.total += 1;
    entry.byType[d.type] = (entry.byType[d.type] || 0) + 1;
    entry.titles.push({ title: d.title, type: d.type, date: d.date });
  });

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Which indexed authors does this free-text question plausibly refer to?
// Used to inject an authoritative fact block for the current turn.
function matchAuthors(index, text) {
  const folded = " " + foldName(text) + " ";
  if (!folded.trim()) return [];
  return index.filter((a) => {
    if (folded.includes(" " + a.key + " ")) return true;
    // Any distinctive single token (first or last name) is enough.
    return a.tokens.some((tok) => tok.length > 2 && folded.includes(" " + tok + " "));
  });
}

/* ------------------------------------------------------------ the fetcher */

let cache = { at: 0, data: null };

async function fetchDocuments() {
  if (!SUPABASE_KEY) {
    const err = new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — the server cannot read the documents table."
    );
    err.code = "NO_KEY";
    throw err;
  }

  const url =
    SUPABASE_URL.replace(/\/+$/, "") +
    "/rest/v1/documents?select=*&order=published_on.desc";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Supabase returned ${res.status} ${res.statusText}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("Unexpected Supabase payload");
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

/** Server-side read, cached for CATALOGUE_TTL_MS. Null when no key is set. */
async function getServerCatalogue() {
  if (!SERVER_READ_ENABLED) return null;

  const now = Date.now();
  if (cache.data && now - cache.at < TTL_MS) return cache.data;

  try {
    const rows = await fetchDocuments();
    const data = buildCatalogue(rows.map(mapRow), "supabase");
    cache = { at: now, data };
    return data;
  } catch (err) {
    console.error("[volt] catalogue fetch failed:", err.message);
    if (cache.data) {
      // Serve stale rather than lying about an empty library.
      return { ...cache.data, stale: true, error: err.message };
    }
    // Short-cache the failure so we retry soon but don't hammer Supabase.
    cache = {
      at: now - TTL_MS + 30000,
      data: {
        available: false,
        source: "supabase",
        docs: [],
        authors: [],
        version: "none",
        fetchedAt: new Date(now).toISOString(),
        error: err.message,
      },
    };
    return cache.data;
  }
}

/**
 * The catalogue VOLT reasons over for one request.
 *
 * Precedence: a successful server-side read wins; otherwise the snapshot the
 * browser sent; otherwise an EMPTY catalogue with `available: false`. It
 * deliberately never falls back to the placeholder rows in data.js —
 * describing fake documents as real is exactly the bug this file fixes.
 *
 * @param {object} [opts]
 * @param {Array}  [opts.clientRows] raw `catalogue` array from the request body
 */
async function getCatalogue(opts) {
  const clientRows = opts && opts.clientRows;

  const server = await getServerCatalogue();
  if (server && server.available) return server;

  const fromClient = sanitizeClientRows(clientRows);
  if (fromClient.length) {
    const data = buildCatalogue(fromClient, "client");
    if (server && server.error) data.serverError = server.error;
    return data;
  }

  return (
    server || {
      available: false,
      source: "none",
      docs: [],
      authors: [],
      version: "none",
      fetchedAt: new Date().toISOString(),
      error: SERVER_READ_ENABLED
        ? "no catalogue available"
        : "no SUPABASE_SERVICE_ROLE_KEY and the browser sent no catalogue",
    }
  );
}

function invalidate() {
  cache = { at: 0, data: null };
}

module.exports = {
  getCatalogue,
  getServerCatalogue,
  invalidate,
  buildAuthorIndex,
  buildCatalogue,
  sanitizeClientRows,
  fingerprint,
  matchAuthors,
  normalizeType,
  foldName,
  mapRow,
  SERVER_READ_ENABLED,
  MAX_DOCS,
};
