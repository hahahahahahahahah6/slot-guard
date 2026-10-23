/* slot-guard unit tests — pure detector functions, no browser needed.
 * Run: node test/run.js
 */
"use strict";
const assert = require("assert");
const detector = require("../src/lib/detector.js");

let n = 0;
function t(name, fn) {
  n++;
  try { fn(); console.log("ok   " + name); }
  catch (e) { console.error("FAIL " + name + ": " + e.message); process.exitCode = 1; }
}

// --- detectChallenge ---
t("challenge: cloudflare 'verifying you are human'", () => {
  assert.strictEqual(detector.detectChallenge({ bodyText: "Verifying you are human", html: "" }), "cloudflare");
});
t("challenge: 'just a moment' + cloudflare", () => {
  assert.strictEqual(detector.detectChallenge({ bodyText: "Just a moment…", html: "cloudflare ray id" }), "cloudflare");
});
t("challenge: captcha marker in html", () => {
  assert.strictEqual(detector.detectChallenge({ bodyText: "Sign in", html: '<div class="g-recaptcha">' }), "captcha");
});
t("challenge: clean page -> null", () => {
  assert.strictEqual(detector.detectChallenge({ bodyText: "Available dates: Jan 5", html: "<div>calendar</div>" }), null);
});

// --- summarize ---
t("summarize: empty matches", () => {
  assert.strictEqual(detector.summarize([]), "");
});
t("summarize: joins + truncates", () => {
  const s = detector.summarize([{ text: "a".repeat(200) }], 120);
  assert.ok(s.length <= 121 && s.endsWith("…"));
});

// --- evaluate ---
const LAST = { count: 1, signature: "Jan 5" };
t("evaluate: first run never alerts (baseline)", () => {
  const r = detector.evaluate({ mode: "text-changed" }, [{ text: "Jan 5" }], null);
  assert.strictEqual(r.changed, false);
  assert.ok(/baseline/.test(r.detail));
});
t("evaluate: text-present appears", () => {
  const r = detector.evaluate({ mode: "text-present" }, [{ text: "Jan 6" }], LAST);
  assert.strictEqual(r.changed, true);
});
t("evaluate: text-present same text -> no alert", () => {
  const r = detector.evaluate({ mode: "text-present" }, [{ text: "Jan 5" }], LAST);
  assert.strictEqual(r.changed, false);
});
t("evaluate: text-absent disappears", () => {
  const r = detector.evaluate({ mode: "text-absent" }, [], LAST);
  assert.strictEqual(r.changed, true);
});
t("evaluate: text-absent still present -> no alert", () => {
  const r = detector.evaluate({ mode: "text-absent" }, [{ text: "Jan 5" }], LAST);
  assert.strictEqual(r.changed, false);
});
t("evaluate: count-changed", () => {
  assert.strictEqual(detector.evaluate({ mode: "count-changed" }, [{ text: "a" }, { text: "b" }], LAST).changed, true);
  assert.strictEqual(detector.evaluate({ mode: "count-changed" }, [{ text: "Jan 5" }], LAST).changed, false);
});
t("evaluate: text-changed default", () => {
  assert.strictEqual(detector.evaluate({ mode: "text-changed" }, [{ text: "Jan 6" }], LAST).changed, true);
  assert.strictEqual(detector.evaluate({ mode: "text-changed" }, [{ text: "Jan 5" }], LAST).changed, false);
});

// --- validateTask ---
t("validateTask: valid", () => {
  const [ok, errs] = detector.validateTask({
    name: "visa", urlPattern: "https://*.example.com/*",
    selector: ".day", mode: "text-changed", intervalMin: 30,
  });
  assert.strictEqual(ok, true); assert.deepStrictEqual(errs, []);
});
t("validateTask: missing name", () => {
  const [ok] = detector.validateTask({ urlPattern: "https://*.example.com/*", selector: ".d", mode: "text-changed", intervalMin: 30 });
  assert.strictEqual(ok, false);
});
t("validateTask: bad interval", () => {
  const [ok, errs] = detector.validateTask({ name: "x", urlPattern: "https://*.example.com/*", selector: ".d", mode: "text-changed", intervalMin: 0 });
  assert.strictEqual(ok, false); assert.ok(errs.join().includes("intervalMin"));
});
t("validateTask: bad mode", () => {
  const [ok] = detector.validateTask({ name: "x", urlPattern: "https://*.example.com/*", selector: ".d", mode: "nope", intervalMin: 30 });
  assert.strictEqual(ok, false);
});
t("validateTask: bad urlPattern", () => {
  const [ok] = detector.validateTask({ name: "x", urlPattern: "not a url", selector: ".d", mode: "text-changed", intervalMin: 30 });
  assert.strictEqual(ok, false);
});

console.log(`\n${n} tests, exit=${process.exitCode || 0}`);
