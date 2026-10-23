/* slot-guard content script — injected on demand via chrome.scripting.
 * Answers { type: 'SG_CHECK' | 'SG_TEST', selector } with a DOM snapshot.
 * Never clicks, never fills forms, never touches bot checks.
 */
(function () {
  if (window.__sgCheckerInstalled) return;
  window.__sgCheckerInstalled = true;

  function snapshot(selector) {
    var out = {
      ok: true, url: location.href, title: document.title,
      matches: [], challenge: false, challengeKind: null,
      bodyText: "", html: "",
    };
    try {
      var els = document.querySelectorAll(selector);
      for (var i = 0; i < els.length && i < 50; i++) {
        out.matches.push({ text: (els[i].innerText || els[i].textContent || "").trim().slice(0, 200) });
      }
    } catch (e) {
      return { ok: false, error: "bad-selector", detail: String(e && e.message || e) };
    }
    // Lightweight challenge signals for the background worker.
    var bodyText = (document.body ? document.body.innerText : "") || "";
    var html = document.documentElement ? document.documentElement.outerHTML.slice(0, 60000) : "";
    out.bodyText = bodyText.slice(0, 8000);
    out.html = html;
    var low = (bodyText + " " + html).toLowerCase();
    if (low.indexOf("verifying you are human") !== -1 ||
        low.indexOf("just a moment") !== -1 && low.indexOf("cloudflare") !== -1) {
      out.challenge = true;
      out.challengeKind = "cloudflare";
    }
    return out;
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || (msg.type !== "SG_CHECK" && msg.type !== "SG_TEST")) return false;
    try {
      sendResponse(snapshot(msg.selector));
    } catch (e) {
      sendResponse({ ok: false, error: "snapshot-failed", detail: String(e && e.message || e) });
    }
    return false;
  });
})();
