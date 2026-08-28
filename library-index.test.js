/* Offline tests for library-index.js — no browser, no network, no API key.
   Run:  node library-index.test.js
   The headline case is the bug this was written for: four phrasings of
   "how many papers by Wissam" that used to return 3, 3, 0 and 1 unrelated
   documents must now return one stable, correct answer. */

const assert = require("assert");
const L = require("./library-index.js");

// A library shaped like the real one: real people plus organizational bylines,
// and the "Whitepaper" / "White Paper" spelling split.
const DOCS = [
  { title: "Behind-the-Meter Storage Economics", author: "Wissam Haddad", type: "Whitepaper", category: "Energy Storage", level: "Advanced", date: "2026-05-10", summary: "Stacking demand-charge savings with energy arbitrage.", tags: ["BESS", "demand charges"] },
  { title: "Demand Charge Management 101", author: "Wissam Haddad", type: "Guide", category: "Energy Storage", level: "Beginner", date: "2026-04-02", summary: "How commercial demand charges are billed.", tags: ["demand charges"] },
  { title: "Community Solar for C&I Hosts", author: "Francisco Alvarez", type: "White Paper", category: "Policy & Incentives", level: "Intermediate", date: "2026-03-11", summary: "Subscription models and bill credits.", tags: ["community solar"] },
  { title: "Interconnection Queue Reform", author: "Francisco Alvarez", type: "Guide", category: "Grid & Interconnection", level: "Advanced", date: "2026-02-01", summary: "Cluster studies and timelines.", tags: ["interconnection", "FERC"] },
  { title: "MACRS Depreciation for Solar Assets", author: "Marcus Reed", type: "Whitepaper", category: "Financing", level: "Advanced", date: "2026-03-01", summary: "Accelerated schedules and bonus depreciation.", tags: ["MACRS", "tax"] },
  { title: "How Net Metering Works", author: "VOLT Explains", type: "Video", category: "Policy & Incentives", level: "Beginner", date: "2026-01-08", summary: "Six-minute explainer on export credits.", tags: ["net metering"] },
  { title: "Power Purchase Agreement Template", author: "Legal & Finance Desk", type: "Template", category: "Financing", level: "Advanced", date: "2026-01-20", summary: "Annotated clauses for term and escalator.", tags: ["PPA"] },
  { title: "Commercial Solar Buyer's Guide", author: "Novitium Energy Team", type: "Guide", category: "Solar PV", level: "Beginner", date: "2026-04-12", summary: "Planning, sizing and procuring a commercial array.", tags: ["procurement"] },
];

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("  ok   " + name); }
  catch (e) { failures++; console.log("  FAIL " + name + "\n       " + e.message); }
}

/* ------------------------------------------------------------------------ */
console.log("\nThe original bug — four phrasings, one answer:");

const PHRASINGS = [
  "how many papers by Wissam",
  "how many papers has Wissam written?",
  "papers by Wissam",
  "What has Wissam written",
];

PHRASINGS.forEach((q) => {
  check(JSON.stringify(q), () => {
    const a = L.answer(q, DOCS);
    assert.ok(a, "expected an answer, got null");
    assert.strictEqual(a.kind, "author", `routed to "${a.kind}" instead of an author lookup`);
    assert.strictEqual(a.author.name, "Wissam Haddad");
    assert.strictEqual(a.author.total, 2);
    const titles = a.author.titles.map((t) => t.title);
    assert.ok(!titles.some((t) => /Community Solar|Interconnection Queue/.test(t)),
      "Francisco's documents leaked into Wissam's record");
    assert.ok(!titles.some((t) => /Net Metering|MACRS/.test(t)),
      "unrelated documents leaked in");
  });
});

check("all four phrasings agree exactly", () => {
  const answers = PHRASINGS.map((q) => JSON.stringify(L.answer(q, DOCS).author.titles));
  assert.strictEqual(new Set(answers).size, 1, "phrasings disagree with each other");
});

/* ------------------------------------------------------------------------ */
console.log("\nStopwords no longer drive matches:");

check('"how" does not match "How Net Metering Works"', () => {
  assert.deepStrictEqual(L.wordsOf("how many papers has Wissam written?"), ["wissam"]);
});

check('"has" does not match "Purchase Agreement"', () => {
  const found = L.searchDocs(DOCS, "how many papers has Wissam written?", 3);
  assert.ok(!found.some((d) => /Purchase Agreement/.test(d.title)), "substring match survived");
});

check("a real topic search still works", () => {
  const found = L.searchDocs(DOCS, "demand charges", 3);
  assert.ok(found.length >= 2);
  assert.ok(/Demand Charge|Storage Economics/.test(found[0].title));
});

check("prefix matching reaches longer words", () => {
  const found = L.searchDocs(DOCS, "interconnect", 3);
  assert.ok(found.some((d) => /Interconnection Queue/.test(d.title)));
});

/* ------------------------------------------------------------------------ */
console.log("\nOrganizational bylines don't hijack topic questions:");

check('"how does energy storage work" is not an author lookup', () => {
  const a = L.answer("how does energy storage work", DOCS);
  assert.ok(!a || a.kind !== "author",
    'matched a byline containing "Energy" — generic-token guard failed');
});

check('"show me financing documents" is not an author lookup', () => {
  const a = L.answer("show me financing documents", DOCS);
  assert.ok(a && a.kind === "browse", `expected browse, got ${a && a.kind}`);
  assert.strictEqual(a.total, 2);
});

check("a full organizational byline still resolves", () => {
  const a = L.answer("what has the Novitium Energy Team published", DOCS);
  assert.ok(a && a.kind === "author");
  assert.strictEqual(a.author.name, "Novitium Energy Team");
  assert.strictEqual(a.author.total, 1);
});

/* ------------------------------------------------------------------------ */
console.log("\nUnknown names and other intents:");

/* Regression: naming an author in FULL must resolve to that one person even
   when a colleague shares a surname. Matching the whole byline and a single
   loose token at equal priority made the more specific question ambiguous. */
const SHARED_SURNAME = DOCS.concat([
  { title: "Rooftop Structural Loads", author: "Sara Haddad", type: "Guide", category: "Installation & O&M", level: "Advanced", date: "2026-03-05", summary: "Ballast and dead-load documentation.", tags: ["structural"] },
]);

check("a full name beats a shared surname", () => {
  const a = L.answer("how many papers by Wissam Haddad", SHARED_SURNAME);
  assert.strictEqual(a.kind, "author", `got "${a.kind}" — the full name should be unambiguous`);
  assert.strictEqual(a.author.name, "Wissam Haddad");
  assert.strictEqual(a.author.total, 2);
});

check("the other full name resolves just as cleanly", () => {
  const a = L.answer("what has Sara Haddad written?", SHARED_SURNAME);
  assert.strictEqual(a.kind, "author");
  assert.strictEqual(a.author.name, "Sara Haddad");
  assert.strictEqual(a.author.total, 1);
});

check("a bare shared surname is genuinely ambiguous, and says so", () => {
  const a = L.answer("papers by Haddad", SHARED_SURNAME);
  assert.strictEqual(a.kind, "authors_multi");
  assert.strictEqual(a.authors.length, 2);
});

check("a first name alone still resolves when it is unique", () => {
  const a = L.answer("what has Wissam written", SHARED_SURNAME);
  assert.strictEqual(a.kind, "author");
  assert.strictEqual(a.author.name, "Wissam Haddad");
});

check("full name still works when nobody shares the surname", () => {
  const a = L.answer("how many papers by Francisco Alvarez", DOCS);
  assert.strictEqual(a.kind, "author");
  assert.strictEqual(a.author.name, "Francisco Alvarez");
  assert.strictEqual(a.author.total, 2);
});

check("an unknown name is admitted, not guessed", () => {
  const a = L.answer("how many papers has Beatriz written?", DOCS);
  assert.ok(a, "expected an answer");
  assert.strictEqual(a.kind, "author_unknown");
  assert.ok(a.authors.length >= 5, "should offer the authors that do exist");
});

check("who wrote <document> resolves to that document's author", () => {
  const a = L.answer("who wrote the MACRS depreciation whitepaper?", DOCS);
  assert.strictEqual(a.kind, "doc_author");
  assert.strictEqual(a.doc.author, "Marcus Reed");
});

check("counting the whole library", () => {
  const a = L.answer("how many documents are in the library?", DOCS);
  assert.strictEqual(a.kind, "count");
  assert.strictEqual(a.total, 8);
});

check("counting within a topic", () => {
  const a = L.answer("how many documents do you have on Energy Storage?", DOCS);
  assert.strictEqual(a.kind, "count");
  assert.strictEqual(a.total, 2);
});

check("counting a type, with the spelling split collapsed", () => {
  const a = L.answer("how many white papers are there?", DOCS);
  assert.strictEqual(a.kind, "count");
  assert.strictEqual(a.total, 3, "Whitepaper and White Paper should count together");
});

/* Regression: VOLT must group types exactly as the site's Document Type
   filter does (keyOf in app.js strips every non-alphanumeric). A row stored
   as "White-Paper" or "White  Paper" was grouped by the filter but counted
   as its own separate type by VOLT, so a white-paper count came back one
   short and the odd document never appeared in the list. */
check("type spellings the filter groups, VOLT groups too", () => {
  const variants = ["White Paper", "Whitepaper", "White-Paper", "white  paper", "WHITEPAPERS", " White Paper "];
  const normalized = variants.map(L.normalizeType);
  assert.deepStrictEqual(
    [...new Set(normalized)],
    ["White Paper"],
    "these should all collapse to one type: " + JSON.stringify(normalized)
  );
});

check("a hyphenated white paper is counted with the rest", () => {
  const mixed = DOCS.concat([
    { title: "Unlocking the Solar ITC", author: "Wissam Haddad", type: "White-Paper", category: "Policy & Incentives", level: "Intermediate", date: "2026-06-01", summary: "Bonus adders and basis reduction.", tags: ["ITC"] },
  ]);
  const a = L.answer("how many white papers are there?", mixed);
  assert.strictEqual(a.kind, "count");
  assert.strictEqual(a.total, 4, "the hyphenated row was excluded");
  assert.ok(a.docs.some((d) => d.title === "Unlocking the Solar ITC"), "it should be listed too");

  // …and it counts toward its author's total.
  const byAuthor = L.answer("what has Wissam written", mixed);
  assert.strictEqual(byAuthor.author.total, 3);
  assert.strictEqual(byAuthor.author.byType["White Paper"], 2);
});

check("case study plurals resolve", () => {
  assert.strictEqual(L.normalizeType("Case Studies"), "Case Study");
  assert.strictEqual(L.normalizeType("casestudy"), "Case Study");
});

check("an unknown type is kept, not silently renamed", () => {
  assert.strictEqual(L.normalizeType("Research Brief"), "Research Brief");
  assert.strictEqual(L.normalizeType("  Field   Report "), "Field Report");
});

check("newest documents come back in date order", () => {
  const a = L.answer("what's new in the library?", DOCS);
  assert.strictEqual(a.kind, "newest");
  assert.strictEqual(a.docs[0].title, "Behind-the-Meter Storage Economics");
});

check("listing the authors", () => {
  const a = L.answer("who are the authors?", DOCS);
  assert.strictEqual(a.kind, "authors_list");
  const total = a.authors.reduce((s, x) => s + x.total, 0);
  assert.strictEqual(total, 8, "author counts must sum to the library size");
});

check("a distinctive topic word alone identifies the category", () => {
  const a = L.answer("show me storage resources", DOCS);
  assert.strictEqual(a.kind, "browse");
  assert.strictEqual(a.label, "Energy Storage");
  assert.strictEqual(a.total, 2);
});

check('"energy" alone is too weak to pick a category', () => {
  const a = L.answer("show me clean energy resources", DOCS);
  assert.ok(!a || a.kind !== "browse", "matched a category on the word 'energy'");
});

check("counting scoped by a topic word", () => {
  const a = L.answer("how many documents on financing?", DOCS);
  assert.strictEqual(a.kind, "count");
  assert.strictEqual(a.total, 2);
});

check("site help is routed, not answered from the knowledge base", () => {
  const a = L.answer("how do I filter the results?", DOCS);
  assert.strictEqual(a.kind, "site_help");
});

check("a conceptual question falls through to the knowledge base", () => {
  assert.strictEqual(L.answer("what is the ITC?", DOCS), null);
  assert.strictEqual(L.answer("explain MACRS", DOCS), null);
  assert.strictEqual(L.answer("how does a PPA work?", DOCS), null);
});

check("an empty library never fabricates", () => {
  const a = L.answer("how many papers by Wissam", []);
  assert.ok(a === null || a.kind === "author_unknown" || a.total === 0);
});

/* ------------------------------------------------------------------------ */
console.log(
  failures === 0
    ? "\nall checks passed\n"
    : `\n${failures} check(s) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
