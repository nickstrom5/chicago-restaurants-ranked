// App Store link for the home page (a file, not an inline script, so the pages' Content-Security-Policy can say
// script-src 'self'). The app went live on 2026-11-02, so index.html's [data-store-btn] buttons now carry the link and
// label in the HTML too (they work without this script, for crawlers and link previews); change the URL in both places.
var APP_STORE_URL = "https://apps.apple.com/app/id6816931379";
if (APP_STORE_URL) {
  document.querySelectorAll("[data-store-btn]").forEach(function (b) { b.href = APP_STORE_URL; b.rel = "noopener"; });
  document.querySelectorAll("[data-store-label]").forEach(function (l) { l.textContent = "Download on the App Store"; });
  document.querySelectorAll("[data-store-note]").forEach(function (n) { n.textContent = "Free on iPhone and iPad. No ads, no in-app purchases."; });
}
