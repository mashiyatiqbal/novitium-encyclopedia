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

  /* ---------------- Build filter UI ---------------- */
  function counts(field) {
    const map = {};
    DOCUMENTS.forEach((d) => { map[d[field]] = (map[d[field]] || 0) + 1; });
    return map;
  }
  const FILTERS = {
    category: { set: () => state.cats, label: "Category" },
    type: { set: () => state.types, label: "Type" },
    author: { set: () => state.authors, label: "Author" },
  };

  function buildFilter(containerId, values, set, field) {
    const c = $("#" + containerId);
    const cnt = counts(field);
    values.forEach((v) => {
      const id = field + "-" + v.replace(/\W+/g, "");
      const label = el("label", "opt");
      label.innerHTML =
        `<input type="checkbox" id="${id}" value="${esc(v)}">` +
        `<span>${esc(v)}</span><span class="count">${cnt[v] || 0}</span>`;
      label.querySelector("input").addEventListener("change", (e) => {
        e.target.checked ? set.add(v) : set.delete(v);
        updateFilterCount(field);
        render();
      });
      c.appendChild(label);
    });
  }
  buildFilter("filter-category", CATEGORIES, state.cats, "category");
  buildFilter("filter-type", DOC_TYPES, state.types, "type");

// Build author filter from unique authors in documents
const AUTHORS = [...new Set(DOCUMENTS.map(d => d.author))].sort();
buildFilter("filter-author", AUTHORS, state.authors, "author");

  /* Update the count badge on a dropdown button + clear-button visibility */
  function updateFilterCount(field) {
    const n = FILTERS[field].set().size;
    const badge = $("#count-" + field);
    if (badge) { badge.textContent = n; badge.hidden = n === 0; }

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
      (state.cats.size === 0 || state.cats.has(d.category)) &&
      (state.types.size === 0 || state.types.has(d.type)) &&
      (state.authors.size === 0 || state.authors.has(d.author))
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
      const [g1, g2] = CAT_COLORS[d.category] || ["#1f5fa8", "#13407a"];
      const icon = TYPE_ICONS[d.type] || TYPE_ICONS.Guide;
      const card = el("article", "card");
      card.innerHTML =
        `<div class="card-thumb" style="--g1:${g1};--g2:${g2}">
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
      botSay("Hi, I'm <strong>VOLT</strong> — your guide to the Novitium Encyclopedia. ☀️ I can explain energy terms, point you to documents, or help you use the site. What can I help with?");
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
  function findDocs(q) {
    const lc = q.toLowerCase();
    const words = lc.split(/\s+/).filter((w) => w.length > 2);
    return DOCUMENTS
      .map((d) => {
        const hay = (d.title + " " + d.summary + " " + d.tags.join(" ") + " " + d.category + " " + d.type).toLowerCase();
        const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
        return { d, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.d);
  }
  function docLink(d) {
    return `<a href="#" data-doc="${esc(d.title)}">${esc(d.title)}</a> <span style="color:var(--slate)">(${esc(d.type)})</span>`;
  }

  /* ---- conversation history sent to the API ---- */
  const history = [];
  let apiAvailable = null; // null = untried, true = live backend, false = fall back

  function msgHtml(text) {
    return esc(text).replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");
  }

  /* Stream a reply from the VOLT backend (SSE). Resolves with the full text,
     or throws if the backend is unreachable / not configured. */
  async function streamChat(messages, onDelta) {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
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
      botSay("Hey there! 👋 Ask me about an energy term, or tell me what you're trying to find.");
      return;
    }
    // thanks
    if (/(thank|thanks|cheers|appreciate)/.test(q)) {
      botSay("Anytime! ☀️ Anything else I can help you find?");
      return;
    }
    // how to use site / search / filter
    if (/(how (do|to)|use the site|search|filter|navigate)/.test(q)) {
      botSay(
        "Easy! Three ways to get around:<br>" +
        "• <strong>Search bar</strong> at the top — type a term, title, or topic.<br>" +
        "• <strong>Filters</strong> on the left — narrow by category, document type, or level.<br>" +
        "• <strong>Popular tags</strong> under the search bar for one-click shortcuts.<br>" +
        "Want me to run a search for you? Just tell me the topic."
      );
      setChips(["Show me financing docs", "What is a PPA?", "Find storage resources"]);
      return;
    }
    // glossary listing
    if (/(glossary|terms|definitions|vocabulary)/.test(q)) {
      botSay(glossaryOverview());
      return;
    }

    // glossary term match
    const g = findGlossary(q);
    if (g) {
      const docs = findDocs(g.term + " " + g.full);
      let extra = docs.length ? "<br><br>📄 Related resources:<br>" + docs.map(docLink).join("<br>") : "";
      botSay(`<strong>${esc(g.full)} (${esc(g.term)})</strong><br>${esc(g.def)}${extra}`);
      return;
    }

    // document search
    const docs = findDocs(q);
    if (docs.length) {
      botSay("Here's what I found in the library:<br><br>" + docs.map(docLink).join("<br>") +
        "<br><br>Want me to filter the page to these results?");
      // also reflect into the page search
      searchInput.value = raw;
      doSearch(raw);
      return;
    }

    // fallback
    botSay(
      "I'm not certain I have a document on that, but I can help with clean-energy terms, financing, incentives, storage, and using this site. " +
      "Try rephrasing, or pick a topic below."
    );
    setChips(["What is the ITC?", "Explain net metering", "How do I search?"]);
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
