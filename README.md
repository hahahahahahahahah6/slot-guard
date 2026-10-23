# slot-guard

A generic page-change watcher Chrome extension (Manifest V3): point it at any
page, give it a CSS selector, and get a desktop notification when the watched
content changes. Built for slot-camping scenarios — visa appointment calendars,
DMV openings, price drops, restocks — without writing a new extension per site.

**Safety rule (non-negotiable):** if a bot check (Cloudflare / CAPTCHA) appears,
the task **pauses itself** and asks you to solve it manually. slot-guard never
attempts to bypass human-verification. Read-only checks only — it never books,
buys, or submits anything.

## How it works

- **Options page** (`src/options/`): create watch tasks — name, URL pattern,
  optional "open URL", CSS selector, watch mode, check interval. Includes a
  **"Test selector on current tab"** button that highlights how many elements
  match before you save.
- **Content script** (`src/content/checker.js`): injected on demand via
  `chrome.scripting` (host permission is requested per site when you save a
  task). Builds a DOM snapshot; never clicks or fills forms.
- **Service worker** (`src/background/service-worker.js`): `chrome.alarms`
  drive the checks; all state in `chrome.storage.local` (MV3-safe). On change
  → desktop notification. On challenge → pause + red badge + notification.
- **Popup**: task list with live status (`OK`, `NEEDS_USER`, `NEEDS_TAB`, `ERROR`).

## Watch modes

| mode | alerts when |
|---|---|
| `text-changed` | the watched text differs from last check (default) |
| `text-present` | the target text appears |
| `text-absent` | the target text disappears |
| `count-changed` | the number of matched elements changes |

## Templates

Two built-in starting points on the options page:

1. **US visa appointment calendar** — for `usvisascheduling.com`; alerts when
   selectable dates appear.
2. **Generic text watcher** — for price/stock flips on any site.

## Install (developer mode)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open the options page, pick a template or create a task, grant the host
   permission when asked, and keep the watched tab open (or set an open URL).

## Tests

The detection/evaluation logic is pure functions with no `chrome.*`
dependencies:

```bash
node test/run.js   # 18/18 must pass
```

## Project status

v0.1.0 MVP. Not yet published to the Chrome Web Store.

## License

MIT — see [LICENSE](LICENSE).
