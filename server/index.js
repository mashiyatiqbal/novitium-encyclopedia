// Novitium Encyclopedia — VOLT chatbot backend
// Serves the static site and proxies chat to the Claude API over SSE,
// keeping ANTHROPIC_API_KEY server-side (never exposed to the browser).

require("dotenv").config();
const path = require("path");
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { buildSystemPrompt } = require("./knowledge");

const PORT = process.env.PORT || 3000;
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-opus-4-8";
const MAX_TURNS = 20; // cap conversation history sent to the API

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "⚠  ANTHROPIC_API_KEY is not set — /api/chat will return 503. " +
      "Copy .env.example to .env and add your key."
  );
}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const SYSTEM_PROMPT = buildSystemPrompt();

const app = express();
app.use(express.json({ limit: "256kb" }));

// Serve the static site (one directory up from /server)
const SITE_DIR = path.join(__dirname, "..");
app.use(express.static(SITE_DIR));

// --- Sanitize incoming history into valid Anthropic message params ---
function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const msgs = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? "").slice(0, 4000),
    }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-MAX_TURNS);
  // The API requires the first message to be from the user.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

app.post("/api/chat", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "Chat is not configured (missing API key)." });
  }

  const messages = normalizeMessages(req.body && req.body.messages);
  if (!messages.length) {
    return res.status(400).json({ error: "No valid messages provided." });
  }

  // Server-Sent Events
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Abort the upstream request if the client disconnects
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    const stream = client.messages.stream(
      {
        model: CHAT_MODEL,
        max_tokens: 1024,
        // Snappy FAQ replies — thinking off keeps latency/cost low.
        thinking: { type: "disabled" },
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        messages,
      },
      { signal: controller.signal }
    );

    stream.on("text", (delta) => send("delta", { text: delta }));

    const final = await stream.finalMessage();
    send("done", {
      stop_reason: final.stop_reason,
      usage: final.usage,
    });
    res.end();
  } catch (err) {
    if (controller.signal.aborted) return; // client went away
    console.error("Chat error:", err && err.message ? err.message : err);
    // If nothing was streamed yet we can still surface a clean error event.
    try {
      send("error", { error: "VOLT had trouble responding. Please try again." });
      res.end();
    } catch (_) {
      /* response already closed */
    }
  }
});

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, model: CHAT_MODEL, keyConfigured: !!process.env.ANTHROPIC_API_KEY })
);

app.listen(PORT, () => {
  console.log(`Novitium Encyclopedia running at http://localhost:${PORT}`);
  console.log(`VOLT model: ${CHAT_MODEL}`);
});
