// Sanity harness — no network, no API key needed.
//   node server/verify.js
// Proves the author index and the prompt agree, and that a first-name-only
// question resolves to exactly one author record.

const assert = require("assert");
const {
  buildAuthorIndex,
  matchAuthors,
  mapRow,
  sanitizeClientRows,
  buildCatalogue,
  getCatalogue,
  MAX_DOCS,
} = require("./catalogue");
const { buildSystemPrompt } = require("./knowledge");

const rows = [
  { title: "Behind-the-Meter Storage Economics", author: "Wissam Haddad", type: "Whitepaper", category: "Energy Storage", level: "Advanced", published_on: "2026-05-10", summary: "s" },
  { title: "Demand Charge Management 101", author: "Wissam Haddad", type: "Guide", category: "Energy Storage", level: "Beginner", published_on: "2026-04-02", summary: "s" },
  { title: "Community Solar for C&I Hosts", author: "Francisco Alvarez", type: "White Paper", category: "Policy & Incentives", level: "Intermediate", published_on: "2026-03-11", summary: "s" },
  { title: "Interconnection Queue Reform", author: "Francisco Alvarez", type: "Guide", category: "Grid & Interconnection", level: "Advanced", published_on: "2026-02-01", summary: "s" },
  { title: "MACRS Depreciation for Solar Assets", author: "Marcus Reed", type: "Whitepaper", category: "Financing", level: "Advanced", published_on: "2026-03-01", summary: "s" },
];

const docs = rows.map(mapRow);
const authors = buildAuthorIndex(docs);
const catalogue = { available: true, docs, authors, fetchedAt: new Date().toISOString() };

// 1. Counts are computed, not guessed.
const wissam = authors.find((a) => a.name === "Wissam Haddad");
assert.strictEqual(wissam.total, 2, "Wissam should have exactly 2 documents");
assert.deepStrictEqual(wissam.byType, { "White Paper": 1, Guide: 1 });

// 2. "Whitepaper" and "White Paper" collapse to one type.
assert.strictEqual(docs.filter((d) => d.type === "White Paper").length, 3);
assert.strictEqual(docs.filter((d) => d.type === "Whitepaper").length, 0);

// 3. A first-name-only question resolves to one author, not two.
const hits = matchAuthors(authors, "how many papers by Wissam?");
assert.strictEqual(hits.length, 1, "expected exactly one author match");
assert.strictEqual(hits[0].name, "Wissam Haddad");

// 4. No cross-attribution: Francisco's titles are not in Wissam's record.
const wissamTitles = wissam.titles.map((t) => t.title);
assert.ok(!wissamTitles.includes("Community Solar for C&I Hosts"));

// 5. An unknown name matches nothing, so VOLT is told to say it doesn't know.
assert.strictEqual(matchAuthors(authors, "anything by Beatriz?").length, 0);

// 6. The prompt carries the same numbers.
const prompt = buildSystemPrompt(catalogue);
assert.ok(prompt.includes("Total documents in the library: 5"));
assert.ok(prompt.includes("Wissam Haddad — TOTAL 2 documents"));
assert.ok(prompt.includes("Francisco Alvarez — TOTAL 2 documents"));
assert.ok(prompt.includes("AUTHOR INDEX"));

// 7. An unavailable catalogue must not let VOLT name anything.
const blind = buildSystemPrompt({ available: false, docs: [], authors: [] });
assert.ok(blind.includes("CATALOGUE UNAVAILABLE"));
assert.ok(!blind.includes("Wissam"));

/* ---------------- client-snapshot path (no service-role key) ------------- */

// 8. A browser snapshot produces the same index as a server read.
const snapshot = rows.map((r) => ({
  title: r.title,
  author: r.author,
  type: r.type,
  category: r.category,
  level: r.level,
  date: r.published_on,
  summary: r.summary,
  tags: [],
}));
const clientCat = buildCatalogue(sanitizeClientRows(snapshot), "client");
assert.strictEqual(clientCat.docs.length, 5);
assert.strictEqual(
  clientCat.authors.find((a) => a.name === "Wissam Haddad").total,
  2
);

// 9. Same content -> same fingerprint, regardless of the order it arrived in.
const shuffled = buildCatalogue(
  sanitizeClientRows([...snapshot].reverse()),
  "client"
);
assert.strictEqual(
  clientCat.version,
  shuffled.version,
  "fingerprint must be order-independent or prompt caching breaks"
);
assert.strictEqual(
  buildSystemPrompt(clientCat),
  buildSystemPrompt(shuffled),
  "identical libraries must produce byte-identical prompts"
);

// 10. Hostile / malformed input is dropped rather than reaching the prompt.
const hostile = sanitizeClientRows([
  null,
  "not an object",
  ["array"],
  { title: "" },
  { title: "x".repeat(5000), author: "y".repeat(5000), evil: "<script>" },
  ...Array.from({ length: MAX_DOCS + 50 }, (_, i) => ({ title: "Doc " + i, author: "A" })),
]);
assert.ok(hostile.length <= MAX_DOCS, "row cap must hold");
const oversized = hostile.find((d) => d.title.startsWith("xxx"));
assert.ok(oversized.title.length <= 300, "long titles must be clipped");
assert.ok(oversized.author.length <= 200, "long authors must be clipped");
assert.ok(!("evil" in oversized), "unknown fields must not survive");

// 11. Precedence: with no service-role key set, the client snapshot is used.
(async () => {
  const resolved = await getCatalogue({ clientRows: snapshot });
  assert.strictEqual(resolved.source, "client");
  assert.strictEqual(resolved.available, true);
  assert.strictEqual(resolved.docs.length, 5);

  // 12. No key AND no snapshot -> VOLT is told it knows nothing.
  const empty = await getCatalogue({});
  assert.strictEqual(empty.available, false);
  assert.ok(buildSystemPrompt(empty).includes("CATALOGUE UNAVAILABLE"));

  console.log("all checks passed");
  console.log("---- author index ----");
  authors.forEach((a) =>
    console.log(`${a.name}: ${a.total} (${JSON.stringify(a.byType)})`)
  );
  console.log("---- catalogue version ----");
  console.log(`${clientCat.version} (source: ${clientCat.source})`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
