# Developer guide

A Chrome extension (Manifest V3) that controls AI content on Google Search:

- **AI Overview:** collapses Google's AI Overview behind a "Show AI Overview" button. Revealing it lasts for that page load only. A separate sub-toggle hides the **AI Mode** tab and button.
- **AI images:** on Google Images, blurs or hides images that **Google itself labels** as AI-generated (e.g. "AI-generated", "Made with Google AI").
- **Master switch:** "Remove all AI" turns everything off without forgetting your individual choices.

Settings sync through `chrome.storage.sync` and apply instantly to open Google tabs.

> **Note:** Google generates the AI Overview on its servers. This extension only hides it in your browser. It does not stop Google from generating it, and it does not change your results.

Scope for v1: Chrome 116+, Google web results (`/search`) and Google Images (`udm=2`, `tbm=isch`). No Gemini sidebars, Discover, Gmail or AI-detection models.

---

## Install (Load unpacked)

1. Download or clone this folder.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. Pin "No AI" from the puzzle-piece menu to reach the popup.

After editing any file, click the reload icon on the extension's card, then reload your Google tabs.

## Project layout

```
manifest.json                 generated host lists; see scripts/
src/platform/browser.js       the only file that touches chrome.* APIs
src/core/settings.js          defaults, master-switch logic, storage
src/core/registry.js          site registry + shared DOM/label helpers
src/core/observer.js          single MutationObserver, rAF-batched
src/core/apply.js             entry point: picks site, writes <html> state
src/sites/google/config.js    ALL selectors + label text (versioned)
src/sites/google/rules.js     overview / AI Mode / image rules
src/sites/google/styles.css   flash guard + all visual treatments
src/sites/google/domains.txt  Google country domains (source of truth)
src/popup/                    popup.html / popup.css / popup.js
scripts/generate-domains.js   writes domain patterns into manifest.json
tests/                        fixtures, checks, manual checklist
```

## How it works

1. `styles.css` is injected at `document_start`. Until the content script has read settings, `<html>` has no `data-noai-ready` attribute, and the CSS hides the overview's known containers and any AI Mode (`udm=50`) link. That's the flash guard.
2. `apply.js` reads settings (falling back to install defaults if storage can't be read within 1.5 s) and writes the state onto `<html>`: `data-noai-overview="on|off"`, `data-noai-aimode="on|off"`, `data-noai-images="blur|hide|off"`, `data-noai-ready`.
3. One `MutationObserver` watches the results container (or `<body>`), batches added nodes per animation frame, and hands them to the site rules.
4. Rules **positively identify** elements by stable attributes or exact localized label text, then **mark** them (`data-noai-block`, `data-noai-ai-image`). They never hide anything directly. The CSS treats marked elements only while their feature is on.
5. A settings change only rewrites the `<html>` attributes, so toggles apply instantly. A feature that was off triggers a one-time rescan when it turns on.

**Fail-safe rules:** if no selector or label matches, nothing happens. An overview container is never hidden if it contains organic results, ads or a whole results column. A flash-guard candidate whose label can't be found is released after about 1 s. Invalid selectors in config are dropped with a console warning. If startup throws, every guard is released.

---

## Updating selectors and label text

Google changes its markup often, and when it does, only `src/sites/google/config.js` should need editing.

1. **Find what broke.** On a live Google page, open DevTools → Elements and inspect the element you expect to be handled. To see what the extension did, search the Elements panel for `data-noai`.
2. **Pick the most stable hook available**, in this order:
   1. Stable attributes: `aria-label`, `role`, `data-*`, `jsname`, URL params in `href` (e.g. `udm=50`).
   2. Localized label text: the visible heading/badge text, added per language.
   3. Class names: last resort. They're obfuscated and change often.
3. **Edit `config.js`:**
   - **Overview:** `overview.labels[lang]` holds the heading text, matched exactly against `headingSelectors`. `columnSelectors` and `mustNotContain` define the safe container. `candidateSelectors` are flash-guard hints.
   - **AI Mode:** `aiMode.linkSelectors` (stable href) and `aiMode.labels[lang]`.
   - **Images:** `images.labels[lang]`, `gridItemSelectors` (the card that fills a grid slot), `panelSelectors` and `panelImageSelectors` (detail view), and `linkAttributes` (shared IDs that tie a panel to its grid card).
4. **Labels** are keyed by the page's `<html lang>`, first the full tag (`pt-br`), then the primary subtag (`pt`). English is always included as well. Matching ignores case, whitespace and quote/dash style but is otherwise **exact**, so add every variant you see rather than a fragment.
5. **If you change `overview.candidateSelectors`, `aiMode.linkSelectors` or `aiMode.regionSelectors`**, mirror them in the matching block of `styles.css`. A static stylesheet can't read JS config; `node tests/check.js` fails if they drift.
6. **Bump `version` and set `lastVerified`** to today's date.
7. **Update the fixtures** in `tests/fixtures/` if the structure changed, run `tests/run.sh`, then work through `tests/MANUAL_TESTS.md`.

### Updating the domain list

Edit `src/sites/google/domains.txt` (one domain per line, without `www.`) and run:

```sh
node scripts/generate-domains.js          # rewrite manifest.json
node scripts/generate-domains.js --check  # CI: fail if manifest is stale
```

Match patterns can't wildcard a TLD, so every country domain is listed for both `www.` and the bare host, restricted to `/search*`.

## Adding a new site rule module

Sites are self-contained modules, so core code doesn't change. For example, to add `src/sites/bing/`:

1. Create `config.js` (selectors and labels, versioned like Google's), `rules.js` and `styles.css`.
2. In `rules.js`, register the site:

   ```js
   NoAI.registerSite({
     id: 'bing',
     // Return a page-type string for pages you handle, or null.
     match(location) { return location.hostname === 'www.bing.com' ? 'web' : null; },
     create(ctx) {
       // ctx.page, ctx.effective ({ overview, aiMode, images }), ctx.rescan(), ctx.poke()
       return {
         features: ['overview'],            // features this page supports
         findRoot() { return document.querySelector('#b_results'); },
         process({ nodes, full, root }) { /* identify + mark */ },
       };
     },
   });
   ```
3. In `styles.css`, key your treatments off the same `<html>` attributes (`data-noai-overview`, etc.) and the shared markers (`data-noai-block`, `data-noai-revealed`, `data-noai-ui`).
4. In `manifest.json`, add a new `content_scripts` entry with the site's matches. Load the shared files first, then your `config.js` and `rules.js`, then `src/core/apply.js` last, with your `styles.css` at `document_start`. Add the site's hosts to `host_permissions`. If the site needs a long domain list, extend `generate-domains.js` the same way as for Google.
5. Add fixtures and a section to the manual checklist.

If a site needs a new kind of feature (say "Shorts" on YouTube), add the setting to `DEFAULTS` and `effective()` in `src/core/settings.js`, the matching `<html>` attribute in `apply.js`, and a row in the popup.

## Adding Firefox / Edge support

- **Edge** is Chromium: the extension should load as-is via `edge://extensions` → Load unpacked. Verify, then publish to the Edge Add-ons store.
- **Firefox (128+)** supports MV3 content scripts and `storage.sync`. `src/platform/browser.js` already prefers the promise-based `browser` namespace when it exists, so feature code needs no changes. Remaining steps:
  1. Add to `manifest.json` (or a Firefox-specific copy produced by a build step):
     ```json
     "browser_specific_settings": { "gecko": { "id": "no-ai@example.org", "strict_min_version": "128.0" } }
     ```
  2. Check host access. Firefox 127+ requests MV3 `host_permissions` at install, but users can revoke them in `about:addons`. If you need to handle that, add a `permissions.contains`/`permissions.request` prompt to the popup, wrapped in `browser.js`.
  3. Drop `minimum_chrome_version` from the Firefox manifest.
  4. Test with `web-ext run`.
- Any further API differences belong in `src/platform/browser.js` only.

## Testing

```sh
tests/run.sh                 # everything below
node tests/check.js          # config/CSS sync, languages, settings logic, manifest
node tests/run-fixtures.js   # fixture assertions in headless Chrome/Chromium/Brave
```

The fixtures (`tests/fixtures/*.html`) are **synthetic** pages that reproduce the structure the rules depend on. They are not saved copies of Google. Open them directly in Chrome to try the features by hand with their built-in settings panel. Before a release, follow `tests/MANUAL_TESTS.md` on live Google.

## Privacy

No AI collects nothing.

- No data collection, analytics, tracking or telemetry.
- No network requests of any kind, and no remote code. All logic ships in the package.
- Permissions: `storage` (to save your five settings) and access to Google Search pages (`https://www.google.*/search*` and the bare `google.*` hosts). No `tabs`, `scripting` or any other permission.
- Settings are stored in `chrome.storage.sync`, which Chrome syncs between your own signed-in browsers. Nothing else is stored.
- The extension reads Google result pages only locally, to find and hide AI elements.
