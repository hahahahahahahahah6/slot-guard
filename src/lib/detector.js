/* slot-guard detector — PURE functions, no chrome.* APIs.
 * Unit-testable in node; the content script builds the snapshot,
 * the service worker calls evaluate().
 *
 * Snapshot: { url, title, matches: [{ text }], challenge: bool,
 *             challengeKind: 'cloudflare'|'captcha'|null }
 */
(function () {
  var SG = (typeof globalThis !== "undefined" ? globalThis.SG = globalThis.SG || {} : {});

  var CHALLENGE_MARKERS = [
    // Cloudflare
    "verifying you are human", "just a moment", "cf-chl", "challenge-platform",
    "cf_clearance", "__cf_bm", "cloudflare ray",
    // Generic bot checks
    "are you a robot", "verify you are human", "complete the security check",
    "unusual traffic",
  ];
  var CAPTCHA_MARKERS = ["g-recaptcha", "h-captcha", "cf-turnstile", "data-sitekey"];

  function norm(s) { return (s || "").toLowerCase(); }

  function detectChallenge(snap) {
    var body = norm(snap.bodyText);
    var html = norm(snap.html);
    for (var i = 0; i < CHALLENGE_MARKERS.length; i++) {
      if (body.indexOf(CHALLENGE_MARKERS[i]) !== -1 ||
          html.indexOf(CHALLENGE_MARKERS[i]) !== -1) {
        return "cloudflare";
      }
    }
    for (var j = 0; j < CAPTCHA_MARKERS.length; j++) {
      if (html.indexOf(CAPTCHA_MARKERS[j]) !== -1) return "captcha";
    }
    return null;
  }

  function summarize(matches, maxChars) {
    maxChars = maxChars || 120;
    var texts = (matches || []).map(function (m) { return (m.text || "").trim(); })
      .filter(function (t) { return t.length > 0; });
    var joined = texts.join(" | ");
    return joined.length > maxChars ? joined.slice(0, maxChars) + "…" : joined;
  }

  // modes: 'text-present' | 'text-absent' | 'text-changed' | 'count-changed'
  // last: previous { signature } or null (first run never alerts).
  function evaluate(task, matches, last) {
    var count = (matches || []).length;
    var signature = summarize(matches, 400);
    var mode = task.mode || "text-changed";
    var result = {
      mode: mode, count: count, signature: signature,
      changed: false, detail: "",
    };
    if (!last) {
      result.detail = "baseline recorded (" + count + " match" +
        (count === 1 ? "" : "es") + ")";
      return result;
    }
    if (mode === "text-present") {
      result.changed = count > 0 && signature !== last.signature;
      result.detail = count > 0 ? "target text appeared" : "target text absent";
    } else if (mode === "text-absent") {
      result.changed = count === 0 && last.count > 0;
      result.detail = count === 0 ? "target text gone" : "target text still present";
    } else if (mode === "count-changed") {
      result.changed = count !== last.count;
      result.detail = "match count " + last.count + " → " + count;
    } else { // text-changed (default)
      result.changed = signature !== last.signature;
      result.detail = result.changed ? "watched text changed" : "no change";
    }
    return result;
  }

  // Validate a task config; returns [ok, errors[]].
  function validateTask(t) {
    var errors = [];
    if (!t || typeof t !== "object") return [false, ["task must be an object"]];
    if (!t.name || !String(t.name).trim()) errors.push("name is required");
    if (!t.urlPattern || !String(t.urlPattern).trim()) {
      errors.push("urlPattern is required (e.g. https://*.example.com/*)");
    } else if (!/^https?:\/\/[^/]+\/\*?$/.test(String(t.urlPattern).trim()) &&
               !/^https?:\/\/[^/]+\//.test(String(t.urlPattern).trim())) {
      errors.push("urlPattern looks invalid");
    }
    if (!t.selector || !String(t.selector).trim()) errors.push("selector is required");
    var modes = ["text-present", "text-absent", "text-changed", "count-changed"];
    if (modes.indexOf(t.mode) === -1) errors.push("mode must be one of " + modes.join(", "));
    var iv = Number(t.intervalMin);
    if (!isFinite(iv) || iv < 1 || iv > 1440) errors.push("intervalMin must be 1–1440");
    return [errors.length === 0, errors];
  }

  SG.detector = {
    detectChallenge: detectChallenge,
    summarize: summarize,
    evaluate: evaluate,
    validateTask: validateTask,
    CHALLENGE_MARKERS: CHALLENGE_MARKERS,
    CAPTCHA_MARKERS: CAPTCHA_MARKERS,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SG.detector;
})();
