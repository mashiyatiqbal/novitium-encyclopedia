/* ==========================================================================
   Novitium Encyclopedia / The Energy Glossary — Auth
   Backed by Supabase Auth (real accounts, hashed passwords, real sessions).

   This file is the ONLY place that talks to the auth backend. To point the
   site at a different production backend later, replace the client setup
   and the five functions below (signUp, signIn, signOut, getSession,
   onAuthChange) with calls to your new backend — every page on the site
   only ever calls window.NovitiumAuth.*, so nothing else needs to change.
   ========================================================================== */
(function () {
    "use strict";

   var SUPABASE_URL = "https://mizlazbsufftjtlvdrjv.supabase.co";
    var SUPABASE_ANON_KEY = "sb_publishable_2XcdpC1rleCs8LUPpeqNtw_SH3VPFvN";

   var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

   async function signUp(name, email, password) {
         var res = await client.auth.signUp({
                 email: email,
                 password: password,
        options: { data: { full_name: name }, emailRedirectTo: "https://mashiyatiqbal.github.io/novitium-encyclopedia/" },         });
         return { user: res.data ? res.data.user : null, error: res.error };
   }

   async function signIn(email, password) {
         var res = await client.auth.signInWithPassword({ email: email, password: password });
         return { session: res.data ? res.data.session : null, error: res.error };
   }

   async function signOut() {
         await client.auth.signOut();
   }

   async function getSession() {
         var res = await client.auth.getSession();
         return (res.data && res.data.session) || null;
   }

   function onAuthChange(cb) {
         client.auth.onAuthStateChange(function (_event, session) {
                 cb(session);
         });
   }

   window.NovitiumAuth = {
         client: client,
         signUp: signUp,
         signIn: signIn,
         signOut: signOut,
         getSession: getSession,
         onAuthChange: onAuthChange,
   };
})();
