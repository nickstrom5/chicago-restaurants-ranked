// App Store link for the home page (a file, not an inline script, so the pages' Content-Security-Policy can say
// script-src 'self'). Once the listing is live, paste its URL here (looks like https://apps.apple.com/app/id123456789).
// Every [data-store-btn] then points at the App Store and its label and note switch automatically.
var APP_STORE_URL = "";
if (APP_STORE_URL) {
  document.querySelectorAll("[data-store-btn]").forEach(function (b) { b.href = APP_STORE_URL; b.rel = "noopener"; });
  document.querySelectorAll("[data-store-label]").forEach(function (l) { l.textContent = "Download on the App Store"; });
  document.querySelectorAll("[data-store-note]").forEach(function (n) { n.textContent = "Free on iPhone and iPad. No ads, no in-app purchases."; });
}
