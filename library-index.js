/* ==========================================================================
   Novitium Encyclopedia — library index

   Deterministic lookups over the DOCUMENTS array: who wrote what, how many,
   what's newest, what's in a topic. These are database questions, not
   language questions — they are answered here, in code, so the answer is the
   same every time it is asked.

   This file replaces the old findDocs() scoring in app.js, which matched
   query words as raw SUBSTRINGS against title+summary+tags and did not index
   the author at all. "how many papers has Wissam written" scored documents on
   "how" (matching "How Net Metering Works") and "has" (matching "Purchase
   Agreement"), returning one, three, or zero unrelated documents depending on
   phrasing — none of them by the author asked about.

   Pure functions, no DOM. Exported as a browser global AND as a CommonJS
   module so the same logic can be unit-tested under Node (see
   library-index.test.js). Mirrors server/catalogue.js, which does the same
   job for VOLT's system prompt.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LibraryIndex = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------- folding */

  function foldText(s) {
    return String(s == null ? "" : s)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  // Question scaffolding and library-generic nouns. Stripping these is what
  // stops "how"/"has"/"papers" from driving document matches.
  var STOPWORDS = new Set(
    ("the a an and or but for nor yet so of to in on at by from with about into over " +
      "how many much what which who whom whose where when why whether does did do done " +
      "is are was were be been being has have had can could should would will shall may " +
      "might must i me my we us our you your it its they them their this that these those " +
      "there here any all some more most other another such no not only own same than too " +
      "very just please thanks thank tell show find give list want need look get got know " +
      "see say said ask asked help " +
      // library-generic nouns: present in almost every question, distinguish nothing
      "paper papers document documents doc docs article articles piece pieces writing " +
      "writings publication publications resource resources material materials file files " +
      "item items entry entries thing things stuff library site page pages written wrote " +
      "write writes writing authored"
    ).split(" ")
  );

  function wordsOf(s) {
    return foldText(s)
      .split(" ")
      .filter(function (w) {
        return w.length > 2 && !STOPWORDS.has(w);
      });
  }

  /* ------------------------------------------------------- type handling */

  // Types are matched on an alphanumeric-only key, exactly like keyOf() in
  // app.js, which is what the Document Type filter uses. Anything less
  // forgiving and VOLT disagrees with the filter: a row stored as
  // "White-Paper" or "White  Paper" would be grouped by the filter but
  // counted as its own separate type by VOLT.
  function typeKey(t) {
    return String(t == null ? "" : t).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  var TYPE_ALIASES = {
    whitepaper: "White Paper",
    whitepapers: "White Paper",
    guide: "Guide",
    guides: "Guide",
    casestudy: "Case Study",
    casestudies: "Case Study",
    video: "Video",
    videos: "Video",
    template: "Template",
    templates: "Template",
    specsheet: "Spec Sheet",
    specsheets: "Spec Sheet",
  };

  function normalizeType(t) {
    var canonical = TYPE_ALIASES[typeKey(t)];
    if (canonical) return canonical;
    // Unknown type: keep the label the library uses, just tidied.
    var raw = String(t == null ? "" : t).replace(/\s+/g, " ").trim();
    return raw || "Document";
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  /* ------------------------------------------------------ author indexing */

  // Honorifics and suffixes that are not part of a searchable name.
  var NAME_NOISE = new Set([
    "dr", "mr", "mrs", "ms", "prof", "pe", "phd", "jr", "sr", "ii", "iii", "esq",
  ]);

  // Bylines are often organizations ("Novitium Energy Team", "Legal & Finance
  // Desk", "Engineering Desk"). Their words are ordinary vocabulary, so
  // matching on them would fire on almost any question — ask "how does energy
  // storage work" and you'd match "Novitium ENERGY Team". Only distinctive
  // tokens are allowed to identify an author on their own; a generic token can
  // still match as part of a full byline.
  var GENERIC_TOKENS = new Set(
    ("energy team desk group staff editorial editors office bureau unit division " +
      "solar storage wind policy incentives financing installation grid " +
      "interconnection maintenance operations legal finance engineering projects " +
      "project manufacturer manufacturers specs spec explains explainer research " +
      "company companies inc llc ltd corp co the and for of").split(" ")
  );

  function nameTokens(byline) {
    return foldText(byline)
      .split(" ")
      .filter(function (tok) {
        return tok.length > 1 && !NAME_NOISE.has(tok);
      });
  }

  /**
   * One entry per distinct byline, with the exact titles behind it.
   * Counts are computed here, in code — never estimated.
   */
  function buildAuthorIndex(docs) {
    var byKey = new Map();

    (docs || []).forEach(function (d) {
      var name = String(d.author || "").replace(/\s+/g, " ").trim() || "Unattributed";
      var key = foldText(name);
      if (!key) return;

      if (!byKey.has(key)) {
        byKey.set(key, {
          key: key,
          name: name,
          tokens: nameTokens(name),
          total: 0,
          byType: {},
          titles: [],
        });
      }
      var e = byKey.get(key);
      var type = normalizeType(d.type);
      e.total += 1;
      e.byType[type] = (e.byType[type] || 0) + 1;
      e.titles.push({ title: d.title, type: type, date: d.date || "" });
    });

    var out = [];
    byKey.forEach(function (v) {
      v.titles.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return String(a.title).localeCompare(String(b.title));
      });
      out.push(v);
    });
    return out.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Which indexed authors does this free-text question refer to?
   *
   * Precedence matters. A question naming a whole byline ("Wissam Haddad")
   * must resolve to that one person even when a colleague shares a surname —
   * matching the full name and a loose token at the same priority made the
   * MORE specific question ambiguous, which is backwards.
   */
  function findAuthors(index, text) {
    var folded = " " + foldText(text) + " ";
    if (folded.trim() === "") return [];

    var exact = [];
    var loose = [];

    (index || []).forEach(function (a) {
      // Whole byline present, e.g. "wissam haddad".
      if (a.key && folded.indexOf(" " + a.key + " ") !== -1) {
        exact.push(a);
        return;
      }
      // Otherwise a single distinctive token is enough ("Wissam", "Haddad"),
      // but a generic one is not ("Energy", "Desk").
      var hit = a.tokens.some(function (tok) {
        return (
          tok.length > 2 &&
          !GENERIC_TOKENS.has(tok) &&
          folded.indexOf(" " + tok + " ") !== -1
        );
      });
      if (hit) loose.push(a);
    });

    // A full-name match wins outright. If several bylines match in full
    // (e.g. "Wissam Haddad" and "Wissam Haddad, P.E." both on record) the
    // caller still gets to disambiguate.
    if (exact.length) return exact;

    // No full name given. If the loose matches all share a distinctive token
    // the visitor actually typed, they are genuinely ambiguous — say so.
    return loose;
  }

  /* -------------------------------------------------------------- search */

  var FIELD_WEIGHTS = {
    title: 4,
    author: 4,
    tags: 3,
    category: 3,
    type: 2,
    summary: 1,
  };

  function docTokenSets(d) {
    return {
      title: foldText(d.title).split(" "),
      author: foldText(d.author).split(" "),
      tags: foldText((d.tags || []).join(" ")).split(" "),
      category: foldText(d.category).split(" "),
      type: foldText(normalizeType(d.type)).split(" "),
      summary: foldText(d.summary).split(" "),
    };
  }

  // Whole-word match, or a prefix match for words long enough that the prefix
  // is meaningful ("interconnect" -> "interconnection"). Never a bare
  // substring — that is what produced the original bug.
  function hits(fieldTokens, word) {
    return fieldTokens.some(function (t) {
      if (t === word) return true;
      if (word.length >= 5 && t.length > word.length && t.indexOf(word) === 0) return true;
      if (t.length >= 5 && word.length > t.length && word.indexOf(t) === 0) return true;
      return false;
    });
  }

  function searchDocs(docs, query, limit) {
    var words = wordsOf(query);
    if (!words.length) return [];

    return (docs || [])
      .map(function (d) {
        var sets = docTokenSets(d);
        var score = 0;
        words.forEach(function (w) {
          Object.keys(FIELD_WEIGHTS).forEach(function (field) {
            if (hits(sets[field], w)) score += FIELD_WEIGHTS[field];
          });
        });
        return { d: d, score: score };
      })
      .filter(function (x) {
        return x.score > 0;
      })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return String(b.d.date || "").localeCompare(String(a.d.date || ""));
      })
      .slice(0, limit || 3)
      .map(function (x) {
        return x.d;
      });
  }

  /* --------------------------------------------------------- aggregates */

  function tally(docs, field) {
    var out = {};
    (docs || []).forEach(function (d) {
      var key = (field === "type" ? normalizeType(d.type) : d[field]) || "Unspecified";
      out[key] = (out[key] || 0) + 1;
    });
    return out;
  }

  function newest(docs, n) {
    return (docs || [])
      .slice()
      .sort(function (a, b) {
        return String(b.date || "").localeCompare(String(a.date || ""));
      })
      .slice(0, n || 3);
  }

  // Words too common to identify a topic on their own. "energy" appears in
  // "Energy Storage" but also in half the questions visitors ask.
  var WEAK_CATEGORY_WORDS = new Set(["energy", "and", "the", "of"]);

  function matchCategory(docs, text) {
    var folded = " " + foldText(text) + " ";
    var cats = Object.keys(tally(docs, "category"));

    // Full category name present, e.g. "energy storage".
    var exact = null;
    cats.forEach(function (c) {
      var f = foldText(c);
      if (f && folded.indexOf(" " + f + " ") !== -1) exact = c;
    });
    if (exact) return exact;

    // Otherwise a distinctive word that belongs to exactly one category:
    // "storage", "financing", "interconnection".
    var owners = new Map();
    cats.forEach(function (c) {
      foldText(c)
        .split(" ")
        .forEach(function (w) {
          if (w.length < 3 || WEAK_CATEGORY_WORDS.has(w)) return;
          if (!owners.has(w)) owners.set(w, new Set());
          owners.get(w).add(c);
        });
    });

    var found = null;
    owners.forEach(function (set, word) {
      if (set.size !== 1) return;
      if (folded.indexOf(" " + word + " ") !== -1) {
        set.forEach(function (c) {
          found = c;
        });
      }
    });
    return found;
  }

  function matchType(docs, text) {
    var folded = " " + foldText(text) + " ";
    var types = Object.keys(tally(docs, "type"));
    var found = null;

    types.forEach(function (t) {
      var f = foldText(t); // "white paper"
      var words = f.split(" ");
      var last = words[words.length - 1];
      var variants = [
        f,
        f + "s",
        f.replace(/ /g, ""), // "whitepaper"
        f.replace(/ /g, "") + "s", // "whitepapers"
      ];
      if (words.length > 1) {
        // "case study" -> "case studies", "white paper" -> "white papers"
        var head = words.slice(0, -1);
        variants.push(head.concat(last + "s").join(" "));
        variants.push(head.concat(last.replace(/y$/, "ies")).join(" "));
      } else {
        variants.push(f.replace(/y$/, "ies"));
      }
      variants.forEach(function (v) {
        if (v && folded.indexOf(" " + v + " ") !== -1) found = t;
      });
    });
    return found;
  }

  /* ---------------------------------------------------------- the router */

  // NOTE: these are tested against FOLDED text, which has had punctuation
  // stripped — "what's new" arrives as "what s new". Patterns must not
  // contain apostrophes.
  var RE = {
    count: /\bhow many\b|\bnumber of\b|\bhow much\b.*\b(document|paper|doc|article|resource)/,
    // Any writing verb counts as an author-shaped question, so that an
    // unrecognized name ("how many papers has Beatriz written") is admitted
    // as an unknown author rather than silently answered as a count.
    authorFrame: /\b(wrote|writes|written|authoring|authored)\b|\bwho is the author\b|\bauthor(s)?\b|\bby whom\b/,
    authorsList: /\b(who are|list|show|which|all|the)\b[^?]*\bauthors?\b|\bauthors?\b[^?]*\b(list|are there|do you have)\b/,
    newest: /\b(newest|latest|most recent|recently added|new(ly)? (added|published)|what s new|whats new)\b/,
    browse: /\b(show|list|find|browse|any|got|have|looking for|anything)\b/,
    siteHelp: /\bhow (do|can) i\b.*\b(search|find|filter|sort|navigate|browse|use)\b|\bsearch bar\b|\bhow.*filters? work\b/,
  };

  /**
   * Answer a structured question about the library, or return null to let the
   * caller fall through to its conceptual knowledge base.
   *
   * Returns DATA, never HTML — rendering belongs to the caller, and this way
   * the routing can be unit-tested.
   */
  function answer(query, docs) {
    var text = String(query || "");
    var folded = foldText(text);
    if (!folded) return null;

    var index = buildAuthorIndex(docs);
    var named = findAuthors(index, text);

    /* --- 1. A specific person was named ------------------------------- */
    if (named.length === 1) {
      return { kind: "author", author: named[0] };
    }
    if (named.length > 1) {
      return { kind: "authors_multi", authors: named };
    }

    /* --- 2. Author-shaped question, nobody recognized ------------------ */
    if (RE.authorsList.test(folded)) {
      return {
        kind: "authors_list",
        authors: index.map(function (a) {
          return { name: a.name, total: a.total };
        }),
        total: docs.length,
      };
    }

    if (RE.authorFrame.test(folded)) {
      // "who wrote the ITC whitepaper" — the subject is a document.
      var target = searchDocs(docs, text, 1);
      if (target.length) return { kind: "doc_author", doc: target[0] };

      return {
        kind: "author_unknown",
        authors: index.map(function (a) {
          return { name: a.name, total: a.total };
        }),
      };
    }

    /* --- 3. Counting -------------------------------------------------- */
    if (RE.count.test(folded)) {
      var cat = matchCategory(docs, text);
      var typ = matchType(docs, text);
      var subset = (docs || []).filter(function (d) {
        return (!cat || d.category === cat) && (!typ || normalizeType(d.type) === typ);
      });
      return {
        kind: "count",
        label: [typ, cat].filter(Boolean).join(" in ") || null,
        total: subset.length,
        docs: subset.slice(0, 5),
        byType: cat || !typ ? tally(subset, "type") : null,
      };
    }

    /* --- 4. What's new ------------------------------------------------ */
    if (RE.newest.test(folded)) {
      return { kind: "newest", docs: newest(docs, 3), total: docs.length };
    }

    /* --- 5. Browse a topic or type ------------------------------------ */
    var bCat = matchCategory(docs, text);
    var bTyp = matchType(docs, text);
    if ((bCat || bTyp) && RE.browse.test(folded)) {
      var found = (docs || []).filter(function (d) {
        return (!bCat || d.category === bCat) && (!bTyp || normalizeType(d.type) === bTyp);
      });
      return {
        kind: "browse",
        label: [bTyp, bCat].filter(Boolean).join(" in ") || "documents",
        docs: found.slice(0, 5),
        total: found.length,
      };
    }

    /* --- 6. How the site works ---------------------------------------- */
    if (RE.siteHelp.test(folded)) return { kind: "site_help" };

    return null;
  }

  return {
    foldText: foldText,
    wordsOf: wordsOf,
    normalizeType: normalizeType,
    plural: plural,
    buildAuthorIndex: buildAuthorIndex,
    findAuthors: findAuthors,
    searchDocs: searchDocs,
    newest: newest,
    tally: tally,
    answer: answer,
    STOPWORDS: STOPWORDS,
    GENERIC_TOKENS: GENERIC_TOKENS,
  };
});
