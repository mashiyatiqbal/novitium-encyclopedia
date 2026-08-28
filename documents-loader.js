/* ============================================================
   Novitium Encyclopedia — document catalogue loader

   Replaces the hardcoded DOCUMENTS array in data.js with the
   live catalogue from Supabase, then starts app.js.

   Nothing in data.js or app.js needs to change. CATEGORIES,
   DOC_TYPES, LEVELS and GLOSSARY are still read from data.js
   exactly as before.

   Script order in index.html:
     supabase-js  ->  auth.js  ->  auth-gate.js
     data.js               (defines the arrays incl. DOCUMENTS)
     documents-loader.js   (this file — empties DOCUMENTS,
                            refills it from Supabase, loads app.js)

   app.js must NOT have its own <script> tag any more; this file
   injects it once the data has arrived. If you ever bump app.js's
   cache-busting version, change APP below to match.
   ============================================================ */

(function () {
  "use strict";

  var APP = "app.js?v=7"; // bumped: catalogue snapshot + library-index routing
  var INDEX = "library-index.js?v=1"; // must finish loading before app.js runs

  /* Load library-index.js, then app.js. Ordering is guaranteed here rather
     than by the order of <script> tags in index.html, so adding the feature
     never depends on remembering to edit two files. If the index fails to
     load, app.js still starts and logs an explicit error. */
  function startApp() {
    var idx = document.createElement("script");
    idx.src = INDEX;
    idx.onload = idx.onerror = function () {
      var s = document.createElement("script");
      s.src = APP;
      document.body.appendChild(s);
    };
    document.body.appendChild(idx);
  }

  /* Postgres columns -> the field names the cards already render. */
  function mapRow(r) {
    return {
      title:    r.title || "Untitled",
      summary:  r.summary || "",
      category: r.category,
      type:     r.type,
      level:    r.level,
      date:     r.published_on,
      readTime: r.read_time,
      author:   r.author,
      tags:     Array.isArray(r.tags) ? r.tags : [],

      /* Files in the private bucket get a sentinel href. The click
         handler at the bottom of this file swaps it for a signed URL
         at the moment someone clicks. Anything hosted elsewhere
         (video) keeps its real link and opens normally. */
      url: r.storage_path
        ? "#doc:" + r.storage_path
        : (r.external_url || "#")
    };
  }

  async function load() {
    try {
      var sb = window.NovitiumAuth && window.NovitiumAuth.client;
      if (!sb) throw new Error("Supabase client unavailable");

      var res = await sb
        .from("documents")
        .select("*")
        .order("published_on", { ascending: false });

      if (res.error) throw res.error;

      DOCUMENTS.length = 0;                      // clear the placeholders
      (res.data || []).forEach(function (row) {
        DOCUMENTS.push(mapRow(row));
      });
    } catch (err) {
      /* Fail to an empty library rather than falling back to
         placeholder cards, which would look like real documents. */
      console.error("[encyclopedia] could not load the catalogue:", err);
      DOCUMENTS.length = 0;
    } finally {
      startApp();
    }
  }

  load();

  /* ----------------------------------------------------------
     Opening a private document.

     Delegated on document, so it covers cards rendered now and
     any rendered later (search results, VOLT's suggestions).
     ---------------------------------------------------------- */
  document.addEventListener("click", async function (e) {
    if (!e.target || !e.target.closest) return;

    var link = e.target.closest('a[href^="#doc:"]');
    if (!link) return;

    e.preventDefault();

    var path  = decodeURIComponent(link.getAttribute("href").slice(5));
    var label = link.textContent;

    /* Open the tab NOW, synchronously, while the user's click is
       still "live". Waiting until after the await below would get
       the popup blocked. */
    var tab = window.open("", "_blank");

    link.textContent = "Opening…";

    try {
      var sb = window.NovitiumAuth.client;

      var sess = await sb.auth.getSession();
      if (!sess.data || !sess.data.session) throw new Error("no-session");

      var signed = await sb.storage
        .from("documents")
        .createSignedUrl(path, 300);           // valid 5 minutes

      if (signed.error || !signed.data) {
        throw signed.error || new Error("no-url");
      }

      if (tab) tab.location.href = signed.data.signedUrl;
      else window.location.href = signed.data.signedUrl;
    } catch (err) {
      if (tab) tab.close();

      if (err && err.message === "no-session") {
        alert("Your session has expired. Please sign in again.");
        window.location.href = "login.html";
      } else {
        console.error("[encyclopedia] could not open the document:", err);
        alert("Couldn't open that document. Please try again.");
      }
    } finally {
      link.textContent = label;
    }
  });
})();
