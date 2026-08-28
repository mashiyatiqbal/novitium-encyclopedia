// Novitium Encyclopedia — VOLT chatbot backend
// Serves the static site and proxies chat to the Claude API over SSE,
// keeping ANTHROPIC_API_KEY server-side (never exposed to the browser).

require("dotenv").config();
const path = require("path");
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { buildSystemPrompt } = require("./knowledge");
const {
  getCatalogue,
  invalidate,
  matchAuthors,
  SERVER_READ_ENABLED,
} = require("./catalogue");

const PORT = process.env.PORT || 3000;
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-3-5-sonnet-latest";
const MAX_TURNS = 20; // cap conversation history sent to the API

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "⚠  ANTHROPIC_API_KEY is not set — /api/chat will return 503. " +
      "Copy .env.example to .env and add your key."
  );
}

// The system prompt is now built per request from the LIVE catalogue
// (catalogue.js caches it, so this is a map lookup on the hot path). Building
// it once at boot meant VOLT described a stale, author-less document list for
// as long as the process stayed up.
const app = express();
const client = new Anthropic();

// Headroom for the catalogue snapshot the browser posts alongside each message
// (capped server-side at CATALOGUE_MAX_DOCS rows regardless).
app.use(express.json({ limit: "1mb" }));

// Allow the GitHub Pages front-end to call this API
const ALLOWED_ORIGINS = [
  "https://mashiyatiqbal.github.io",
  "http://localhost:3000",
];
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Serve the static site (one directory up from /server)
const SITE_DIR = path.join(__dirname, "..");
app.use(express.static(SITE_DIR));

// Quick non-streaming test
app.get("/api/test", async (_req, res) => {
  try {
    console.log("Testing Claude API (non-stream)...");
    const msg = await client.messages.create({
      model: CHAT_MODEL,
      max_tokens: 50,
      messages: [{ role: "user", content: "Say OK" }],
    });
    console.log("Test success:", msg.content[0].text);
    res.json({ ok: true, model: CHAT_MODEL, reply: msg.content[0].text });
  } catch (err) {
    console.error("Test error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Sanitize incoming history into valid Anthropic message params ---
function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const msgs = raw
    .filter(
      (m) => m && (m.role === "user" || m.role === "assistant") && m.content
    )
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? "").slice(0, 4000),
    }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-MAX_TURNS);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

app.post("/api/chat", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "Chat is not configured (missing API key)." });
  }

  const messages = normalizeMessages(req.body.messages);
  if (!messages.length) {
    return res.status(400).json({ error: "No valid messages provided." });
  }

  console.log("POST /api/chat model:", CHAT_MODEL, "msgs:", messages.length);

  // Live catalogue -> system prompt for THIS request.
  //
  // If SUPABASE_SERVICE_ROLE_KEY is configured the server reads Supabase
  // itself. If not, we index the snapshot the browser posted — it already
  // read the table under the visitor's own session to render the cards.
  // Either way the counting happens here, in code.
  const catalogue = await getCatalogue({ clientRows: req.body.catalogue });
  const systemPrompt = buildSystemPrompt(catalogue);

  console.log(
    `[volt] catalogue: ${catalogue.docs.length} docs / ${catalogue.authors.length} authors ` +
      `(source: ${catalogue.source}, version: ${catalogue.version})`
  );

  // Belt and braces: if the visitor's latest question names someone who is in
  // the author index, restate that person's exact record as a system fact for
  // this turn. Counting questions then have the answer sitting right next to
  // the question instead of buried in a long list.
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const named = lastUser ? matchAuthors(catalogue.authors || [], lastUser.content) : [];
  const factBlock = named.length
    ? "AUTHORITATIVE RECORD for the name(s) in the visitor's latest message. " +
      "Use these exact counts and titles verbatim; do not add, drop, or re-count.\n" +
      named
        .map(
          (a) =>
            `${a.name}: ${a.total} document${a.total === 1 ? "" : "s"} total.\n` +
            a.titles.map((t) => `  - "${t.title}" (${t.type})`).join("\n")
        )
        .join("\n") +
      "\nNo other document in the library is written by these people."
    : null;

  // Server-Sent Events
  const origin = req.headers.origin || "";
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...(ALLOWED_ORIGINS.includes(origin) && {
      "Access-Control-Allow-Origin": origin,
    }),
  });
  res.flushHeaders();
  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let aborted = false;
  req.on("close", () => { aborted = true; });

  try {
    console.log("Streaming from Claude...");
    const stream = client.messages.stream(
      {
        model: CHAT_MODEL,
        max_tokens: 2048,
        // Factual lookups should not vary run to run. Sampling at the default
        // temperature is a second reason the same question got two different
        // answers.
        temperature: 0,
        system: [
          // Cached: this block only changes when the catalogue changes.
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
          // Not cached: specific to this turn.
          ...(factBlock ? [{ type: "text", text: factBlock }] : []),
        ],
        messages,
      },
      { signal: new AbortController().signal }
    );

    for await (const event of stream) {
      if (aborted) break;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send("delta", { text: event.delta.text });
      }
    }
    console.log("Stream complete.");
    const final = await stream.finalMessage();
    send("done", { stop_reason: final.stop_reason, usage: final.usage });
    res.end();
  } catch (err) {
    if (aborted) return;
    console.error("Chat error:", err && err.message ? err.message : err);
    try {
      send("error", { error: "VOLT had trouble responding. Please try again." });
      res.end();
    } catch (_) {}
  }
});

app.get("/api/health", async (_req, res) => {
  const cat = await getCatalogue();
  res.json({
    ok: true,
    model: CHAT_MODEL,
    keyConfigured: !!process.env.ANTHROPIC_API_KEY,
    catalogue: {
      // Note: this reflects the SERVER-side view only. With no service-role
      // key configured, VOLT still works — it indexes the snapshot each
      // browser posts — but there is nothing to report here.
      serverReadEnabled: SERVER_READ_ENABLED,
      available: cat.available,
      source: cat.source,
      documents: cat.docs.length,
      authors: cat.authors.length,
      version: cat.version,
      fetchedAt: cat.fetchedAt,
      stale: !!cat.stale,
      error: cat.error || null,
    },
  });
});

// What VOLT believes about the library, for debugging an answer.
// POST a {catalogue:[...]} body to inspect what a given browser snapshot
// would produce; GET shows the server-side view.
app.all("/api/catalogue", async (req, res) => {
  const cat = await getCatalogue({ clientRows: req.body && req.body.catalogue });
  res.json({
    available: cat.available,
    source: cat.source,
    version: cat.version,
    fetchedAt: cat.fetchedAt,
    total: cat.docs.length,
    authors: (cat.authors || []).map((a) => ({
      name: a.name,
      total: a.total,
      byType: a.byType,
      titles: a.titles.map((t) => t.title),
    })),
  });
});

// Call after publishing or re-attributing a document so VOLT picks it up
// without waiting out the cache TTL.
app.post("/api/catalogue/refresh", async (_req, res) => {
  invalidate();
  const cat = await getCatalogue();
  res.json({ ok: cat.available, documents: cat.docs.length, authors: cat.authors.length });
});

app.listen(PORT, () => {
  console.log(`Novitium Encyclopedia running at http://localhost:${PORT}`);
  console.log(`VOLT model: ${CHAT_MODEL}`);
});
