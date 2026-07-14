/* Gate: redirect unauthenticated visitors away from the library before it
   ever renders. Include this script (after auth.js) only on pages that
   should require login. */
(function () {
    "use strict";

   function wireLogoutButton() {
         var btn = document.getElementById("logout-btn");
         if (!btn) return;
         btn.addEventListener("click", async function () {
                 await window.NovitiumAuth.signOut();
                 window.location.replace("login.html");
         });
   }

   (async function () {
         var session = await window.NovitiumAuth.getSession();
         if (!session) {
                 window.location.replace("login.html");
                 return;
         }

        document.documentElement.classList.add("auth-ready");

        window.NovitiumAuth.onAuthChange(function (session) {
                if (!session) window.location.replace("login.html");
        });

        if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", wireLogoutButton);
        } else {
                wireLogoutButton();
        }
   })();
})();
