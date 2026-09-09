/* ==========================================================================
   Novitium Encyclopedia — application logic
   - Search bar + multi-facet filtering + sorting
   - VOLT: a rule-based assistant that answers from the glossary + document set
   ========================================================================== */
(function () {
  "use strict";
  /* ---------------- State ---------------- */
  const state = {
    query: "",
    cats: new Set(),
    types: new Set(),
    authors: new Set(),
    sort: "newest",
  };

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* Loose key for comparing label text to the values stored on documents:
     "White Paper", "white paper" and "Whitepaper" all reduce to "whitepaper",
     so a filter option can never silently miss its own documents. */
  const keyOf = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const hasKey = (set, v) => {
    const k = keyOf(v);
    for (const s of set) if (keyOf(s) === k) return true;
    return false;
  };
  const byKey = (map) => {
    const m = {};
    Object.keys(map).forEach((k) => { m[keyOf(k)] = map[k]; });
    return m;
  };

  /* Document types we never offer as a filter option. */
  const HIDDEN_TYPES = new Set(["specsheet", "template"]);

  /* Filter options, built from the documents that actually loaded, using the
     tidy label from data.js whenever one matches. Preferred order first, then
     anything the data has that data.js doesn't know about. */
  function optionList(preferred, field, hidden) {
    const out = [], seen = new Set();
    const push = (v) => {
      const k = keyOf(v);
      if (!k || seen.has(k) || (hidden && hidden.has(k))) return;
      seen.add(k);
      out.push(v);
    };
    const inData = new Set(DOCUMENTS.map((d) => keyOf(d[field])));
    preferred.forEach((v) => { if (inData.has(keyOf(v))) push(v); });
    const extras = DOCUMENTS.map((d) => d[field]).filter((v) => v && !seen.has(keyOf(v)));
    extras.sort((a, b) => String(a).localeCompare(String(b)));
    extras.forEach(push);
    return out;
  }

  /* ---------------- Build filter UI ---------------- */
  const FILTERS = {
    category: { set: () => state.cats, label: "Category" },
    type: { set: () => state.types, label: "Type" },
    author: { set: () => state.authors, label: "Author" },
  };

  function buildFilter(containerId, values, set, field) {
    const c = $("#" + containerId);
    values.forEach((v) => {
      const id = field + "-" + v.replace(/\W+/g, "");
      const label = el("label", "opt");
      label.innerHTML =
        `<input type="checkbox" id="${id}" value="${esc(v)}">` +
        `<span>${esc(v)}</span>`;
      label.querySelector("input").addEventListener("change", (e) => {
        e.target.checked ? set.add(v) : set.delete(v);
        updateFilterCount(field);
        render();
      });
      c.appendChild(label);
    });
  }
  buildFilter("filter-category", optionList(CATEGORIES, "category"), state.cats, "category");
  buildFilter("filter-type", optionList(DOC_TYPES, "type", HIDDEN_TYPES), state.types, "type");
  buildFilter("filter-author", optionList([], "author"), state.authors, "author");

  /* Update the count badge on a dropdown button + clear-button visibility */
  function updateFilterCount(field) {
    const n = FILTERS[field].set().size;
    const badge = $("#count-" + field);
    if (badge) { badge.textContent = n; badge.hidden = n === 0; }

    const anyActive = Object.keys(FILTERS).some((f) => FILTERS[f].set().size > 0);
    $("#clear-filters").hidden = !anyActive;
  }

  /* Active-filter chips below the toolbar */
  function renderActiveFilters() {
    const bar = $("#active-filters");
    bar.innerHTML = "";
    Object.keys(FILTERS).forEach((field) => {
      FILTERS[field].set().forEach((v) => {
        const chip = el("span", "fchip",
          `${esc(v)} <button aria-label="Remove ${esc(v)}" data-field="${field}" data-val="${esc(v)}">×</button>`);
        bar.appendChild(chip);
      });
    });
  }

  $("#active-filters").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-field]");
    if (!b) return;
    const { field, val } = b.dataset;
    FILTERS[field].set().delete(val);
    const cb = document.querySelector(`#filter-${field} input[value="${CSS.escape(val)}"]`);
    if (cb) cb.checked = false;
    updateFilterCount(field);
    render();
  });

  /* Dropdown open/close */
  document.querySelectorAll(".dd").forEach((dd) => {
    const btn = dd.querySelector(".dd-btn");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = !dd.classList.contains("open");
      document.querySelectorAll(".dd.open").forEach((o) => { o.classList.remove("open"); o.querySelector(".dd-btn").setAttribute("aria-expanded", "false"); });
      dd.classList.toggle("open", willOpen);
      btn.setAttribute("aria-expanded", String(willOpen));
    });
    dd.querySelector(".dd-panel").addEventListener("click", (e) => e.stopPropagation());
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".dd.open").forEach((o) => { o.classList.remove("open"); o.querySelector(".dd-btn").setAttribute("aria-expanded", "false"); });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".dd.open").forEach((o) => o.classList.remove("open")); });

  /* Per-category preview colors + per-type icons + author initials */
  const CAT_COLORS = {
    "Solar PV": ["#f6a13a", "#db7a16"],
    "Energy Storage": ["#2f6fb5", "#1b407a"],
    "Wind": ["#2f9e8f", "#1c7165"],
    "Policy & Incentives": ["#7d63c4", "#553f9c"],
    "Financing": ["#2f8a55", "#1d5d39"],
    "Installation & O&M": ["#c0562f", "#9a4220"],
    "Grid & Interconnection": ["#3a6ea5", "#244e7d"],
  };
  const TYPE_ICONS = {
    Guide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5a2 2 0 0 1 2-2h7v18H6a2 2 0 0 0-2 2V5z"/><path d="M20 3h-7v18h5a2 2 0 0 0 2-2V3z"/></svg>',
    Whitepaper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/><path d="M9 13h6M9 17h6M9 9h2"/></svg>',
    "Spec Sheet": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16M15 4v16"/></svg>',
    Template: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 11h6M9 15h4"/></svg>',
    "Case Study": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    Video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9l5 3-5 3z" fill="currentColor"/></svg>',
  };
  /* Same loose matching for the card colours and icons, so a document typed
     "White Paper" still gets the whitepaper icon. */
  const CAT_COLORS_K = byKey(CAT_COLORS);
  const TYPE_ICONS_K = byKey(TYPE_ICONS);

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }

  /* ---------------- Search + filter + sort ---------------- */
  function matchesQuery(d, q) {
    if (!q) return true;
    const hay = (d.title + " " + d.summary + " " + d.category + " " + d.type + " " + d.tags.join(" ")).toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  }

  function filtered() {
    let list = DOCUMENTS.filter((d) =>
      matchesQuery(d, state.query) &&
      (state.cats.size === 0 || hasKey(state.cats, d.category)) &&
      (state.types.size === 0 || hasKey(state.types, d.type)) &&
      (state.authors.size === 0 || hasKey(state.authors, d.author))
    );
    if (state.sort === "newest") list.sort((a, b) => b.date.localeCompare(a.date));
    if (state.sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
    if (state.sort === "category") list.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    return list;
  }

  function highlight(text, q) {
    const safe = esc(text);
    if (!q) return safe;
    const words = q.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length) return safe;
    return safe.replace(new RegExp("(" + words.join("|") + ")", "gi"), "<mark>$1</mark>");
  }

  function fmtDate(iso) {
    const [y, m, d] = iso.split("-");
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function render() {
    const list = filtered();
    const wrap = $("#results");
    wrap.innerHTML = "";
    $("#result-count").textContent = list.length;
    $("#query-label").textContent = state.query ? `for “${state.query}”` : "";
    renderActiveFilters();

    if (!list.length) {
      wrap.innerHTML =
        `<div class="empty" style="grid-column:1/-1">
           <h3>No resources found</h3>
           <p>Try fewer filters or a different search term — or ask VOLT for help finding it.</p>
         </div>`;
      return;
    }

    list.forEach((d) => {
      const [g1, g2] = CAT_COLORS_K[keyOf(d.category)] || ["#1f5fa8", "#13407a"];
      const icon = TYPE_ICONS_K[keyOf(d.type)] || TYPE_ICONS.Guide;
      const card = el("article", "card");

      /* Two thumbnails, one markup path. When the row has a rendered cover
         page we lay the image over the gradient and mark the block
         .has-cover, which hides the fake page-lines graphic in CSS. With no
         cover — an external video, an unsupported file type, or a document
         whose cover job hasn't run yet — the original generated placeholder
         renders unchanged, so the grid never shows a hole.

         onerror strips .has-cover, so a deleted or still-uploading cover
         falls back to the placeholder instead of leaving a broken image. */
            const coverImg = d.cover
        ? `<img class="thumb-blur" src="${esc(d.cover)}" alt="" aria-hidden="true"
                loading="lazy" decoding="async" onerror="this.remove();">
           <img class="thumb-img" src="${esc(d.cover)}" alt="" loading="lazy" decoding="async"
                onerror="this.closest('.card-thumb').classList.remove('has-cover');this.remove();">`
        : "";

      card.innerHTML =
        `<div class="card-thumb${d.cover ? " has-cover" : ""}" style="--g1:${g1};--g2:${g2}">
           ${coverImg}
           <span class="thumb-type">${esc(d.type)}</span>
           <span class="thumb-icon">${icon}</span>
           <span class="thumb-page"><i></i><i></i><i></i><i></i><i></i></span>
           <span class="thumb-cat">${esc(d.category)}</span>
         </div>
         <div class="card-content">
           <h3>${highlight(d.title, state.query)}</h3>
           <p class="synopsis">${highlight(d.summary, state.query)}</p>
           <div class="tags">${d.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>
         </div>
         <div class="card-foot">
           <div class="author">
             <span class="avatar">${esc(initials(d.author))}</span>
             <span class="byline"><strong>${esc(d.author)}</strong><small>${fmtDate(d.date)} · ${esc(d.readTime)} · ${esc(d.level)}</small></span>
           </div>
           <a class="open" href="${esc(d.url)}">Open →</a>
         </div>`;
      wrap.appendChild(card);
    });
  }

  /* ---------------- Search wiring ---------------- */
  const searchInput = $("#search");
  function doSearch(v) { state.query = v.trim(); render(); }
  searchInput.addEventListener("input", (e) => doSearch(e.target.value));
  $("#search-btn").addEventListener("click", () => { doSearch(searchInput.value); document.getElementById("library").scrollIntoView({ behavior: "smooth" }); });
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#search-btn").click(); });

  document.querySelectorAll(".quick-tags button").forEach((b) =>
    b.addEventListener("click", () => { searchInput.value = b.dataset.q; doSearch(b.dataset.q); document.getElementById("library").scrollIntoView({ behavior: "smooth" }); })
  );

  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });

  $("#clear-filters").addEventListener("click", () => {
    state.cats.clear(); state.types.clear(); state.authors.clear();
    document.querySelectorAll(".dd-panel input[type=checkbox]").forEach((c) => (c.checked = false));
    ["category", "type", "author"].forEach(updateFilterCount);
    render();
  });

  /* Featured document topics (· separated, echoes the brand library deck) */
  const TOPICS = [
    "Solar PV Technology", "Grid Integration", "Energy Storage",
    "Commercial Solar Development", "Carbon Footprint Analysis", "Renewable Energy Policy",
    "PPA Structures", "Feasibility Studies", "LCOE Analysis",
    "Net Metering", "Battery Systems", "Project Finance",
  ];
  const topicsEl = $("#topics-list");
  if (topicsEl) {
    topicsEl.innerHTML = TOPICS
      .map((t) => `<b>${esc(t)}</b>`)
      .join('<span class="dot">·</span>');
  }

  /* Subscribe form (front-end acknowledgement; wire to your ESP/back end) */
  const ctaForm = $("#cta-form");
  if (ctaForm) {
    ctaForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = $("#cta-email").value.trim();
      if (!email) return;
      ctaForm.innerHTML = `<p style="margin:0;color:var(--orange-2);font-size:14px;">Thanks — we'll let you know when new documents land. ☀️</p>`;
    });
  }

  // Nav shortcuts
  if ($("#nav-glossary")) $("#nav-glossary").addEventListener("click", (e) => { e.preventDefault(); searchInput.value = ""; doSearch(""); openChat(); botSay(glossaryOverview()); });

  render();

  /* ======================================================================
     VOLT — rule-based assistant
     ====================================================================== */
  const fab = $("#chat-fab");
  const panel = $("#chat-panel");
  const body = $("#chat-body");
  const chipBar = $("#chat-chips");
  let greeted = false;

  function openChat() {
    panel.classList.add("open");
    fab.style.display = "none";
    if (!greeted) {
      greeted = true;
      botSay("Hi, I'm <strong>VOLT</strong> — your guide to the Novitium Encyclopedia. ☀️ I can answer questions on any topic, explain clean energy concepts, help you find documents, or just have a conversation. What can I help with?");
      setChips(["What is the ITC?", "How do I search?", "Explain net metering"]);
    }
  }
  function closeChat() { panel.classList.remove("open"); fab.style.display = "flex"; }
  fab.addEventListener("click", openChat);
  $("#chat-close").addEventListener("click", closeChat);
  if ($("#nav-ask")) $("#nav-ask").addEventListener("click", (e) => { e.preventDefault(); openChat(); });

  function addMsg(who, html) {
    const m = el("div", "msg " + who);
    if (who === "bot") m.innerHTML = `<img src="assets/volt-photo.png" alt="VOLT"><div class="bubble">${html}</div>`;
    else m.innerHTML = `<div class="bubble">${html}</div>`;
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    return m;
  }
  function botSay(html) {
    const typing = el("div", "msg bot typing");
    typing.innerHTML = `<img src="assets/volt-photo.png" alt="VOLT"><div class="bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;
    setTimeout(() => { typing.remove(); addMsg("bot", html); }, 420);
  }
  function setChips(arr) {
    chipBar.innerHTML = "";
    arr.forEach((t) => {
      const b = el("button", null, esc(t));
      b.addEventListener("click", () => { addMsg("user", esc(t)); respond(t); });
      chipBar.appendChild(b);
    });
  }

  $("#chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#chat-text").value.trim();
    if (!v) return;
    addMsg("user", esc(v));
    $("#chat-text").value = "";
    respond(v);
  });

  /* ---- knowledge helpers ---- */
  function glossaryOverview() {
    return "Here are some common terms — ask me about any of them:<br>" +
      GLOSSARY.slice(0, 8).map((g) => `<a href="#" data-term="${esc(g.term)}">${esc(g.term)}</a>`).join(" · ");
  }
  function findGlossary(q) {
    const lc = q.toLowerCase();
    return GLOSSARY.find((g) => lc.includes(g.term.toLowerCase()) || lc.includes(g.full.toLowerCase()));
  }
  /* Document search. Delegates to library-index.js, which tokenizes and
     matches on whole words across weighted fields (title and author weighted
     highest) after stripping question scaffolding.

     The previous implementation scored raw SUBSTRING hits over
     title+summary+tags and never indexed the author, so question words did the
     matching: "how" hit "How Net Metering Works", "has" hit "Purchase
     Agreement". Asking who wrote what returned unrelated documents, and a
     different count for every phrasing. */
  let warnedNoIndex = false;
  function libraryIndexMissing() {
    if (!warnedNoIndex) {
      warnedNoIndex = true;
      console.error(
        "[volt] library-index.js did not load — VOLT cannot answer questions " +
          "about authors, counts or topics. Check that index.html includes " +
          '<script src="library-index.js"> BEFORE app.js is injected.'
      );
    }
    return true;
  }

  function findDocs(q, limit) {
    if (typeof LibraryIndex === "undefined") return libraryIndexMissing() ? [] : [];
    return LibraryIndex.searchDocs(DOCUMENTS, q, limit || 3);
  }
  function docLink(d) {
    // Normalize so "Whitepaper" and "White Paper" don't appear side by side.
    const type = typeof LibraryIndex !== "undefined" ? LibraryIndex.normalizeType(d.type) : d.type;
    return `<a href="#" data-doc="${esc(d.title)}">${esc(d.title)}</a> <span style="color:var(--slate)">(${esc(type)})</span>`;
  }
  function docLines(list) {
    return list.map((d) => "- " + docLink(d)).join("<br>");
  }
  function typeBreakdown(byType) {
    const keys = Object.keys(byType || {}).sort();
    if (!keys.length) return "";
    return keys.map((k) => LibraryIndex.plural(byType[k], k.toLowerCase())).join(", ");
  }

  /* Renders a structured answer from library-index.js. Counts and
     attributions come from the data, never from a guess — the same question
     always produces the same reply. */
  function renderLibraryAnswer(a) {
    switch (a.kind) {
      case "author": {
        const au = a.author;
        const breakdown = typeBreakdown(au.byType);
        return (
          `<strong>${esc(au.name)}</strong> has ${LibraryIndex.plural(au.total, "document")} ` +
          `in the library${breakdown ? " — " + esc(breakdown) : ""}:<br><br>` +
          au.titles
            .map((t) => "- " + docLink({ title: t.title, type: t.type }))
            .join("<br>") +
          "<br><br>Want a summary of any of them?"
        );
      }
      case "authors_multi":
        return (
          "I found more than one author in that question:<br><br>" +
          a.authors
            .map((x) => `- <strong>${esc(x.name)}</strong> — ${LibraryIndex.plural(x.total, "document")}`)
            .join("<br>") +
          "<br><br>Which one did you mean?"
        );
      case "author_unknown":
        return (
          "I don't see anyone by that name in the library. Here's who is on record:<br><br>" +
          a.authors
            .map((x) => `- <strong>${esc(x.name)}</strong> — ${LibraryIndex.plural(x.total, "document")}`)
            .join("<br>") +
          "<br><br>Ask me about any of them and I'll list what they've written."
        );
      case "authors_list":
        return (
          `The library has ${LibraryIndex.plural(a.total, "document")} across ` +
          `${LibraryIndex.plural(a.authors.length, "author")}:<br><br>` +
          a.authors
            .map((x) => `- <strong>${esc(x.name)}</strong> — ${LibraryIndex.plural(x.total, "document")}`)
            .join("<br>")
        );
      case "doc_author":
        return (
          `<strong>${esc(a.doc.title)}</strong> is by <strong>${esc(a.doc.author)}</strong>` +
          `${a.doc.date ? " (" + esc(fmtDate(a.doc.date)) + ")" : ""}.<br><br>` +
          docLink(a.doc) +
          "<br><br>Want to know what else they've written?"
        );
      case "count": {
        if (!a.total) {
          return (
            `I don't have anything${a.label ? " under " + esc(a.label) : ""} in the library yet. ` +
            "Try a broader topic and I'll show you what's there."
          );
        }
        const scope = a.label ? " under " + esc(a.label) : " in the library";
        const breakdown = a.byType ? typeBreakdown(a.byType) : "";
        return (
          `There ${a.total === 1 ? "is" : "are"} <strong>${LibraryIndex.plural(a.total, "document")}</strong>` +
          `${scope}${breakdown && !a.label ? " — " + esc(breakdown) : ""}.<br><br>` +
          docLines(a.docs) +
          (a.total > a.docs.length ? `<br><br>…and ${a.total - a.docs.length} more.` : "")
        );
      }
      case "newest":
        return (
          "The most recent additions:<br><br>" +
          a.docs
            .map((d) => "- " + docLink(d) + (d.date ? ` <span style="color:var(--slate)">${esc(fmtDate(d.date))}</span>` : ""))
            .join("<br>")
        );
      case "browse":
        if (!a.total) {
          return `I don't have any ${esc(a.label)} in the library yet. Want me to show you a related topic?`;
        }
        return (
          `${LibraryIndex.plural(a.total, "document")} under <strong>${esc(a.label)}</strong>:<br><br>` +
          docLines(a.docs) +
          (a.total > a.docs.length ? `<br><br>…and ${a.total - a.docs.length} more.` : "")
        );
      case "site_help":
        return (
          "Here's how to get around:<br>" +
          "- Use the <strong>search bar</strong> at the top — it matches titles, summaries and tags.<br>" +
          "- In <strong>Filter &amp; Search Documents</strong> there are three dropdowns: " +
          "<strong>Topic</strong>, <strong>Document Type</strong> and <strong>Author</strong>. " +
          "You can pick several values in each, and your choices appear as chips you can remove.<br>" +
          "- <strong>Clear filters</strong> resets everything, and the sort control sits next to the result count.<br><br>" +
          "Tell me what you're after and I'll tell you exactly what's in the library."
        );
      default:
        return null;
    }
  }

  /* ---- conversation history sent to the API ---- */
  const history = [];
  let apiAvailable = null; // null = untried, true = live backend, false = fall back

  function msgHtml(text) {
    return esc(text).replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");
  }

  /* A compact copy of the live catalogue for VOLT.

     documents-loader.js has already read the `documents` table under this
     visitor's own authenticated session — that's what rendered the cards. We
     hand the server the result so it can answer "who wrote what" and "how
     many" from real data instead of guessing. The server re-sanitizes and
     caps this, and prefers its own Supabase read when one is configured. */
  function catalogueSnapshot() {
    if (typeof DOCUMENTS === "undefined" || !Array.isArray(DOCUMENTS)) return [];
    return DOCUMENTS.slice(0, 500).map(function (d) {
      return {
        title: d.title,
        author: d.author,
        type: d.type,
        category: d.category,
        level: d.level,
        date: d.date,
        summary: d.summary,
        tags: Array.isArray(d.tags) ? d.tags.slice(0, 12) : [],
      };
    });
  }

  /* Stream a reply from the VOLT backend (SSE). Resolves with the full text,
     or throws if the backend is unreachable / not configured. */
  async function streamChat(messages, onDelta) {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, catalogue: catalogueSnapshot() }),
    });
    if (!resp.ok || !resp.body) throw new Error("backend " + resp.status);

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "", errored = null;

    const handle = (chunk) => {
      let event = "message", data = "";
      chunk.split("\n").forEach((line) => {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      });
      if (!data) return;
      let payload; try { payload = JSON.parse(data); } catch { return; }
      if (event === "delta" && payload.text) { full += payload.text; onDelta(payload.text); }
      else if (event === "error") { errored = payload.error || "error"; }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        handle(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    }
    if (buf.trim()) handle(buf);
    if (errored) throw new Error(errored);
    return full;
  }

  /* Top-level responder: use the live AI backend when available, otherwise
     fall back to the built-in rule-based assistant. Callers add the user
     bubble themselves; this only manages the bot reply + history. */
  async function respond(raw) {
    if (apiAvailable === false) { localRespond(raw); return; }

    history.push({ role: "user", content: raw });

    const typing = el("div", "msg bot typing");
    typing.innerHTML = `<img src="assets/volt-photo.png" alt="VOLT"><div class="bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;

    let bubble = null, full = "";
    try {
      full = await streamChat(history, (delta) => {
        if (!bubble) {
          typing.remove();
          bubble = addMsg("bot", "").querySelector(".bubble");
        }
        bubble.innerHTML = msgHtml(full + delta);
        body.scrollTop = body.scrollHeight;
      });
      apiAvailable = true;
      typing.remove();
      if (!full.trim()) { if (bubble) bubble.closest(".msg").remove(); localRespond(raw); return; }
      if (bubble) bubble.innerHTML = msgHtml(full);
      history.push({ role: "assistant", content: full });
    } catch (e) {
      typing.remove();
      if (bubble) bubble.closest(".msg").remove();
      history.pop(); // drop the user turn; the fallback is self-contained
      if (apiAvailable === null) apiAvailable = false; // backend absent → use local bot for the session
      localRespond(raw);
    }
  }

  /* ---- the rule-based fallback responder ---- */
  function localRespond(raw) {
    const q = raw.toLowerCase().trim();

    // greetings
    if (/^(hi|hey|hello|yo|howdy)\b/.test(q)) {
      botSay("Hey there! I'm Volt, your clean energy guide. Ask me about solar incentives, financing structures, storage, net metering, or any industry topic — I'll explain it and help you find resources.");
      setChips(["What is the ITC?", "How does a PPA work?", "Explain MACRS", "What is net metering?"]);
      return;
    }

    /* ---- structured questions about the library ----
       Who wrote what, how many, what's newest, what's in a topic, how the
       site works. All answered from DOCUMENTS by library-index.js, so the
       same question always gets the same answer. Anything it can't classify
       returns null and falls through to the knowledge base below. */
    if (typeof LibraryIndex === "undefined") {
      libraryIndexMissing();
    } else {
      const structured = LibraryIndex.answer(raw, DOCUMENTS);
      if (structured) {
        const html = renderLibraryAnswer(structured);
        if (html) {
          botSay(html);
          if (structured.kind === "author" || structured.kind === "author_unknown") {
            setChips(["Who are the authors?", "What's new in the library?", "How do I filter?"]);
          } else if (structured.kind === "site_help") {
            setChips(["Who are the authors?", "What's new?", "How many documents are there?"]);
          }
          return;
        }
      }
    }

    // glossary listing
    if (/(glossary|terms|definitions|vocabulary)/.test(q)) {
      botSay(glossaryOverview());
      return;
    }

    // ---- COMPREHENSIVE KNOWLEDGE BASE ----
    const KB = [
      { m: /itc.*macrs|macrs.*itc|how.*itc.*relate|how.*relate.*itc|itc.*depreciation|incentive.*depreciation|combine.*itc/,
        a: "<strong>ITC + MACRS Together:</strong> These two incentives stack powerfully. The ITC gives a 30%+ direct tax credit in year one. MACRS allows 5-year accelerated depreciation (with bonus depreciation taking 60-80%+ in year one) on the remaining 85% basis. Combined, they can improve a commercial solar project's IRR by 3-5 percentage points — making tax equity structures like partnership flips and sale-leasebacks viable. Example: a $1M project gets $300K ITC credit + $120K+ in year-one depreciation tax savings.",
        c: ["What is tax equity?", "What is a partnership flip?", "What is the ITC basis reduction?"] },
      { m: /\bitc\b|investment tax credit|how.*itc.*work|itc.*explain/,
        a: "<strong>Investment Tax Credit (ITC):</strong> The ITC is a federal tax credit equal to 30%+ of solar system costs, claimed in the year the system is placed in service. Under the IRA (2022), bonus adders can push it to 50-70%: the domestic content bonus (+10%), energy community bonus (+10%), and low-income community adder (+10-20%). It's a direct dollar-for-dollar reduction in federal tax liability — far more valuable than a deduction.",
        c: ["How does ITC relate to MACRS?", "What are ITC adders?", "How does a PPA affect the ITC?"] },
      { m: /\bmacrs\b|modified accelerated cost|macrs.*explain|depreciation.*solar|bonus depreciation/,
        a: "<strong>MACRS Depreciation:</strong> Solar equipment qualifies for 5-year MACRS under the IRS's tax code. With bonus depreciation provisions (Tax Cuts and Jobs Act), owners could deduct 60-80%+ of the asset basis in year one. When stacked with the ITC, you must reduce the depreciable basis by 50% of the ITC amount (e.g., 30% ITC → 85% of costs as depreciable basis). This dramatically front-loads cash flows and improves project IRR.",
        c: ["How does ITC relate to MACRS?", "What is bonus depreciation?", "What is tax equity?"] },
      { m: /ppa.*itc|itc.*ppa|who.*claim.*itc|developer.*own.*itc|third.party.*own/,
        a: "<strong>PPA Ownership & the ITC:</strong> In a PPA, the <em>developer</em> owns the system and claims the ITC and MACRS — not the building owner. This is by design: developers use tax equity investors to monetize these credits, lowering the cost of capital and enabling below-market electricity rates. The offtaker benefits through cheaper electricity but can't claim incentives they don't own. Post-IRA, transferability rules let developers sell credits to third parties, which broadens the market beyond traditional tax equity.",
        c: ["What is tax equity?", "What is transferability?", "What is a partnership flip?"] },
      { m: /\bppa\b|power purchase agreement|how.*ppa.*work|ppa.*explain|what.*ppa/,
        a: "<strong>Power Purchase Agreement (PPA):</strong> A PPA is a contract where a developer owns and installs a solar system on your property and you purchase the electricity it produces at a set $/kWh rate — typically below your utility rate — for 10-25 years. The developer claims all tax incentives (ITC, MACRS). You get clean energy with no upfront capital. At term end, you can usually buy the system, extend the contract, or have it removed. PPAs transfer project risk to the developer.",
        c: ["Who claims the ITC in a PPA?", "PPA vs lease vs loan", "What is tax equity?"] },
      { m: /\brec\b|renewable energy certificate|renewable energy credit|srec|how.*rec.*work/,
        a: "<strong>RECs (Renewable Energy Certificates):</strong> A REC represents the environmental attributes of 1 MWh of renewable electricity generation. They're tradeable — utilities buy them to meet Renewable Portfolio Standards (RPS); corporations buy them for ESG/Scope 2 goals. SRECs (Solar RECs) are state-specific and often worth more. If you sell your RECs, you can no longer claim the electricity as 'renewable' for your own reporting. REC prices range from <$1 to $300+ depending on type and state.",
        c: ["What is an RPS?", "RECs vs carbon offsets", "What are SRECs worth?"] },
      { m: /net metering|nem|net energy metering|how.*net meter|excess.*solar.*grid|export.*grid/,
        a: "<strong>Net Metering (NEM):</strong> Net metering is a utility billing arrangement where excess solar electricity exported to the grid earns bill credits, typically at or near the retail electricity rate. When your system underproduces, you draw from the grid and credits offset the cost. Policies vary significantly by state: California's NEM 3.0 (2023) drastically reduced export credits, making battery storage more attractive. Net metering requires separate interconnection and NEM tariff enrollment with your utility.",
        c: ["What is interconnection?", "How does storage help with NEM?", "What is NEM 3.0?"] },
      { m: /\binterconnection\b|how.*interconnect|utility.*grid.*connect|interconnection queue|ferc.*order/,
        a: "<strong>Interconnection:</strong> Interconnection is the process of connecting a generation system to the utility grid. It involves an application, technical studies (feasibility, system impact, facility studies), an interconnection agreement, and protection equipment installation. The interconnection queue is a major bottleneck — hundreds of GW are waiting in US queues. FERC Order 2023 (effective 2024) aims to reform the process with cluster studies and faster timelines. Small behind-the-meter systems can take months; large utility-scale projects can take 5+ years.",
        c: ["What is FERC Order 2023?", "Grid-scale vs behind-the-meter", "What is an ISO?"] },
      { m: /tax equity|partnership flip|sale leaseback|inverted lease|how.*tax equity/,
        a: "<strong>Tax Equity:</strong> Tax equity financing lets investors (typically banks with large tax liability) fund renewable projects in exchange for ITC and MACRS benefits. The two main structures are: <strong>Partnership Flip</strong> (investor receives ~99% of allocations until target yield is hit, then 'flips' to developer) and <strong>Sale-Leaseback</strong> (developer sells asset to investor, leases it back). Post-IRA, <em>transferability</em> lets developers sell tax credits directly to buyers — reducing reliance on complex tax equity structures.",
        c: ["What is the ITC?", "What is MACRS?", "What is transferability?"] },
      { m: /\bira\b|inflation reduction act|direct pay|transferability.*credit|clean energy.*2022/,
        a: "<strong>Inflation Reduction Act (IRA) 2022:</strong> The IRA is the largest US climate investment ever, extending and expanding clean energy incentives through 2032+: <br>• 30% ITC extended with bonus adders (domestic content, energy community, low-income) reaching 50-70%<br>• Standalone storage now qualifies for ITC<br>• <strong>Direct Pay</strong>: nonprofits and municipalities receive ITC as a cash refund<br>• <strong>Transferability</strong>: developers can sell tax credits to third parties<br>• Production Tax Credit (PTC) available as alternative to ITC for solar",
        c: ["What are ITC adders?", "What is direct pay?", "What is the domestic content bonus?"] },
      { m: /\blcoe\b|levelized cost|cost.*per.*kwh|cost.*energy.*generation/,
        a: "<strong>LCOE (Levelized Cost of Energy):</strong> LCOE is the all-in average cost of electricity over a project's lifetime — capex, opex, and financing divided by total lifetime kWh production. It enables comparison across technologies. Commercial solar LCOE has fallen below $0.04/kWh in many regions (90% cost reduction since 2010), making it among the cheapest generation sources. Battery storage adds cost but adds value through demand charge reduction and grid services.",
        c: ["What is capacity factor?", "How is solar IRR calculated?", "LCOE vs LCOS"] },
      { m: /\birr\b|internal rate of return|project.*return|return.*investment.*solar/,
        a: "<strong>IRR (Internal Rate of Return):</strong> IRR is the annual return rate at which a project's NPV equals zero — the key financial metric for renewable energy investment decisions. Unlevered commercial solar IRRs typically range from 7-14%. The ITC + MACRS combination can improve IRR by 3-5 percentage points. Tax equity investors target 6-8% after-tax yields; developers target 12-18% to compensate for development risk. Higher electricity rates, better incentives, and lower capex all improve IRR.",
        c: ["How do ITC and MACRS affect IRR?", "What is DSCR?", "What is tax equity yield?"] },
      { m: /capacity factor|how much.*solar.*produce|solar.*output/,
        a: "<strong>Capacity Factor:</strong> Capacity factor is actual energy produced divided by maximum possible output at full rated capacity, expressed as a percentage. US utility-scale solar: 15% (cloudy Northeast) to 28%+ (Southwest). A 10 MW system at 22% capacity factor produces ~1,927 MWh/year. Fixed-tilt systems have lower capacity factors than single-axis trackers (+15-25%). Capacity factor directly determines revenue and LCOE — it's the key site-selection variable.",
        c: ["What is a solar tracker?", "What is irradiance?", "Capacity factor vs availability"] },
      { m: /\bdemand charge\b|demand charge.*reduce|peak.*demand|ratchet/,
        a: "<strong>Demand Charges:</strong> Demand charges are utility fees based on a customer's peak power draw (kW) during a billing period, often measured as the highest 15-minute interval. For commercial customers, demand charges can represent 30-70% of the total electric bill. Solar alone rarely reduces demand charges effectively because peak demand often occurs when solar isn't generating (morning ramp, evening peak). Battery storage specifically targets demand charge reduction by 'clipping' peak demand intervals.",
        c: ["How does storage reduce demand charges?", "Time-of-use rates", "What is demand response?"] },
      { m: /\bpace\b|property assessed clean energy|c-pace|how.*pace.*work/,
        a: "<strong>PACE Financing:</strong> Property Assessed Clean Energy (PACE) financing lets property owners fund clean energy upgrades through a special property tax assessment — repaid on the property tax bill over 5-25 years. C-PACE (commercial) is available in many states and can fund solar, efficiency, and storage. PACE doesn't require strong personal credit and transfers with the property. Key caveat: PACE liens typically hold senior priority over existing mortgages, which can conflict with lenders.",
        c: ["PACE vs solar loan", "What is C-PACE?", "PACE vs PPA"] },
      { m: /community solar|shared solar|solar farm.*subscribe|virtual net metering/,
        a: "<strong>Community Solar:</strong> Community solar lets customers subscribe to a share of an off-site solar farm's output and receive utility bill credits without installing panels. It's ideal for renters, shaded properties, or those who can't host panels. Available in ~25 states. Subscribers typically save 5-15% on electricity. Developers build, finance, and operate the farms; utilities administer the billing credits. RECs can be retained or sold separately from the energy credits.",
        c: ["RECs in community solar", "Virtual net metering", "Community solar vs rooftop"] },
      { m: /\bwhat\s+is\s+(a\s+)?offtake|offtaker|power purchase|who\s+buys.*solar/,
        a: "<strong>Offtaker:</strong> An offtaker is the entity contracting to purchase power from a generation project. In utility-scale solar, offtakers are usually utilities (under regulated tariffs) or corporations (under corporate PPAs). Offtaker credit quality is critical — investment-grade offtakers reduce project finance risk and enable cheaper debt. Corporate PPAs are increasingly common as companies pursue Scope 2 emissions reduction goals.",
        c: ["What is a corporate PPA?", "What is a virtual PPA?", "What is offtake risk?"] }
    ];

    for (const entry of KB) {
      if (entry.m.test(q)) {
        const docs = findDocs(raw);
        const docLinks = docs.length ? "<br><br><em>Related resources:</em><br>" + docs.map(docLink).join("<br>") : "";
        botSay(entry.a + docLinks);
        if (entry.c) setChips(entry.c);
        return;
      }
    }

    // ---- cross-topic / conceptual connection questions ----
    const TOPIC_EXPLANATIONS = {
      "storage|battery|batteries|bess|demand charge": {
        label: "energy storage",
        explain: "Energy storage (usually batteries) lets you capture solar power when it's generated and use it later. Post-IRA, standalone storage now qualifies for the 30% ITC. For commercial sites, storage cuts demand charges and improves resilience."
      },
      "itc|investment tax credit|tax credit|incentive|incentives|policy|macrs|depreciation|adder|domestic content": {
        label: "ITC / MACRS / incentives",
        explain: "The ITC provides a 30%+ direct tax credit on solar costs (up to 70% with bonus adders under IRA). MACRS allows 5-year accelerated depreciation. Together they front-load project economics, improving IRR by 3-5 points and enabling tax equity structures."
      },
      "ppa|power purchase agreement|financing|finance|fund|loan|lease|pace|offtake|tax equity": {
        label: "financing / PPAs",
        explain: "A PPA lets a business go solar with no upfront cost — a developer owns the system and you buy the electricity. The developer claims ITC and depreciation. Alternatives include loans, leases, and PACE. The right structure depends on your tax appetite and balance sheet."
      },
      "grid|interconnection|utility|net metering|nem|queue|ferc|iso": {
        label: "grid & interconnection",
        explain: "Connecting to the utility grid requires an interconnection process, technical studies, and agreements. Net metering lets you export excess solar for bill credits. Interconnection queues are a major bottleneck for large projects."
      },
      "wind|turbine": {
        label: "wind energy",
        explain: "Commercial wind captures kinetic energy using turbines. Wind and solar are complementary — wind often generates more at night and in seasons when solar output is lower, making hybrid projects attractive."
      },
      "installation|install|o&m|maintenance|operations|roof|ground mount|epc": {
        label: "installation & O&M",
        explain: "Commercial solar installation involves site assessment, structural engineering, permitting, and utility coordination. EPC contractors handle turnkey delivery. Ongoing O&M (cleaning, monitoring, inverter checks) ensures peak performance."
      },
      "rec|renewable energy certificate|srec|carbon|offset|scope 2|rps": {
        label: "RECs & environmental attributes",
        explain: "RECs represent 1 MWh of renewable generation and are tradeable. Utilities buy them to meet RPS requirements; corporations buy for ESG/Scope 2 goals. SRECs are solar-specific and often more valuable. Selling RECs means you can't claim the electricity as 'renewable' for your own reporting."
      },
      "lcoe|levelized|capacity factor|irr|return|yield|project finance|dscr": {
        label: "project economics",
        explain: "Key metrics: LCOE (all-in cost per kWh over project life), IRR (annual return on investment), and capacity factor (actual vs. potential output). ITC+MACRS typically adds 3-5 IRR points. Tax equity investors target 6-8% yields; developers target 12-18%."
      }
    };

    const isConceptual = /(what is|explain|how does|relate|difference|compare|between|versus|vs\.?|tell me about|describe|overview|mean|defined|definition)/.test(q);
    const matchedTopics = [];
    for (const [pattern, info] of Object.entries(TOPIC_EXPLANATIONS)) {
      if (new RegExp(pattern).test(q)) matchedTopics.push(info);
    }

    if (isConceptual && matchedTopics.length >= 2) {
      const topicLabels = matchedTopics.map(t => t.label).join(" & ");
      const explanations = matchedTopics.map(t => "<strong>" + t.label.charAt(0).toUpperCase() + t.label.slice(1) + ":</strong> " + t.explain).join("<br><br>");
      const docs = findDocs(raw);
      const docLinks = docs.length ? "<br><br><em>Relevant resources:</em><br>" + docs.map(docLink).join("<br>") : "";
      botSay("Here's how <strong>" + topicLabels + "</strong> connect:<br><br>" + explanations + "<br><br>These areas interact closely in commercial energy projects." + docLinks);
      return;
    }

    if (isConceptual && matchedTopics.length === 1) {
      const topic = matchedTopics[0];
      const docs = findDocs(raw);
      const docLinks = docs.length ? "<br><br><em>Relevant resources:</em><br>" + docs.map(docLink).join("<br>") : "";
      botSay("<strong>" + topic.label.charAt(0).toUpperCase() + topic.label.slice(1) + ":</strong> " + topic.explain + docLinks);
      return;
    }

    // glossary term match
    const g = findGlossary(q);
    if (g) {
      const extra = g.related && g.related.length ? "<br><br><em>Related terms:</em> " + g.related.map(r => `<a href="#" data-term="${esc(r)}">${esc(r)}</a>`).join(", ") : "";
      botSay(`<strong>${esc(g.full)} (${esc(g.term)})</strong><br>${esc(g.def)}${extra}`);
      return;
    }

    // document search — chat only, the page is left exactly as the visitor
    // arranged it. The links below open documents on click.
    const docs = findDocs(raw);
    if (docs.length) {
      botSay(
        "Here's what I found in the library:<br><br>" +
          docLines(docs) +
          "<br><br>Click any of them to open it, or ask me about a topic and I'll go deeper."
      );
      return;
    }

    // general fallback
    const solar = /(solar|pv|photovoltaic|panel)/.test(q);
    const energy = /(energy|power|electric|grid|carbon|clean|renewable|wind|hydro|nuclear)/.test(q);
    if (solar || energy) {
      botSay("Great question on " + (solar ? "solar" : "clean energy") + "! I'm still building out my knowledge base. For now, try asking me about: ITC, MACRS, PPAs, net metering, RECs, storage, interconnection, tax equity, LCOE, IRR, or capacity factor — I have detailed answers on all of these!");
      setChips(["What is the ITC?", "How does a PPA work?", "Explain net metering"]);
      return;
    }
    botSay("I specialize in clean energy finance and technology. Ask me about solar incentives, financing structures, grid topics, or project economics — I can explain and relate any industry concept!");
    setChips(["What is the ITC?", "Explain MACRS", "How do PPAs work?"]);
  }

  // delegate clicks on bot-generated term/doc links
  body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-term]");
    const d = e.target.closest("[data-doc]");
    if (t) { e.preventDefault(); addMsg("user", esc(t.dataset.term)); respond(t.dataset.term); }
    if (d) {
      e.preventDefault();
      searchInput.value = d.dataset.doc; doSearch(d.dataset.doc);
      document.getElementById("library").scrollIntoView({ behavior: "smooth" });
      botSay(`I've pulled that up in the library for you. ☝️`);
    }
  });
})();
