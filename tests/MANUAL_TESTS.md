# Manual test checklist

Run before every release and after any change to `src/sites/google/config.js`.
Automated checks come first: `tests/run.sh` (static checks plus fixture
assertions in headless Chromium, in light and dark mode).

**Setup:** load the extension unpacked (see README), then open a normal window
and an Incognito window if you've allowed the extension to run in Incognito.
"Live" means a real Google results page. "Fixture" means the files in
`tests/fixtures/`, opened directly in Chrome (they have their own settings
panel in the bottom-right corner).

Record the date and Chrome version: ____________ / ____________

## 1. Install defaults
- [ ] Fresh install: popup shows Master on, AI Overview on, AI Mode tab on, AI images on, Blur selected.
- [ ] Live: search `how does coffee work`. The overview is replaced by "Show AI Overview" and there's no AI Mode tab.

## 2. AI Overview
- [ ] The overview is not visible at any point while the page loads (no flash). Reload a few times.
- [ ] Click "Show AI Overview". The overview appears, the button reads "Hide AI Overview" and the chevron flips.
- [ ] Tab to the button with the keyboard. The focus ring is visible, Enter and Space toggle it, and a screen reader announces it as collapsed/expanded.
- [ ] Run a new search. The overview is hidden again.
- [ ] Turn the AI Overview toggle off in the popup. The overview appears immediately without a reload, and the button disappears. Turn it on and it's hidden again.

## 3. Late-loading overview
- [ ] Live: find a query where the overview streams in after the results (it shows a loading shimmer first). No flash, and the button appears.
- [ ] Fixture `google-web-ai-overview.html`: click "Late overview". It's hidden within a frame of the heading appearing.

## 4. AI Mode tab
- [ ] Live: the AI Mode tab in the tab row and the AI Mode button by the search box are gone, with no empty gap left.
- [ ] Other tabs (All, Images, Videos, News, …) are all present and work.
- [ ] Toggle AI Mode tab off: the tab reappears instantly. On: it's gone again.
- [ ] Opening AI Mode directly (`/search?udm=50&q=x`) is left completely alone.

## 5. AI images
- [ ] Live Google Images: find an image Google labels as AI-generated (e.g. "Made with Google AI" in its details panel). Note the query used: ____________
- [ ] Blur mode: labelled thumbnails are blurred with an "AI-generated · Show anyway" button. Nothing else is blurred.
- [ ] "Show anyway" reveals only that image and does not open the detail panel.
- [ ] Open a labelled image. The panel image is blurred, and if the label only appeared in the panel, the grid thumbnail is now blurred too.
- [ ] Click a non-AI image next. The panel image is not blurred (no stale treatment).
- [ ] Hide mode: labelled cards disappear and the grid closes up with no gaps.
- [ ] Switching between Blur and Hide applies instantly.
- [ ] Fixture `google-images-labelled.html`: all of the above, using the panel buttons.

## 6. Master switch
- [ ] Turn AI Mode tab off, then Master off. Every sub-control is greyed out and can't be focused, and every feature on open tabs is disabled immediately.
- [ ] Master on: the AI Overview and AI images toggles are still on and AI Mode tab is still off. The page matches.
- [ ] With two Google tabs open, a change in the popup applies to both without a reload.

## 7. Infinite scroll / more results
- [ ] Live: scroll to "More results" or continuous scroll. New results are untouched and the page stays responsive.
- [ ] Live Images: scroll far down. Newly loaded labelled images are treated and others are not.
- [ ] Fixtures: "Infinite scroll" buttons on both pages.

## 8. Dark mode
- [ ] OS dark mode: the popup switches to dark colours, and focus rings and disabled states are still clearly visible.
- [ ] Google in dark theme: the "Show AI Overview" button is legible (it inherits the page text colour), and the image reveal button is legible.

## 9. Non-English domain
- [ ] Live `google.de` (or `?hl=de`): the overview ("Übersicht mit KI") is hidden and the AI Mode tab ("KI-Modus") is gone.
- [ ] Repeat for at least one more of fr, es, it, pt, nl, ja, hi: ____________
- [ ] A language without labels (e.g. `?hl=tr`): pages work normally. Anything identified by stable attributes (the AI Mode link) is still handled, and nothing else is hidden.
- [ ] Fixture: "Non-English" button.

## 10. Selector failure (fail-safe)
- [ ] Fixture: "Selector failure" button. The unknown block stays visible, and the hint-class block without a label appears within about 1 s.
- [ ] Temporarily edit `config.js` so `overview.labels.en` is `['XYZ']` and reload the extension. Live: the overview is shown normally, with no button, no gaps and no console errors other than `[No AI]` warnings.
- [ ] Temporarily add an invalid selector (e.g. `'div[['`) to a config list. One `[No AI] ignoring invalid selector` warning appears and everything else still works.
- [ ] Revert both edits.

## 11. Privacy / permissions
- [ ] `chrome://extensions` → Details: permissions list only "Read and change your data on" Google sites, and storage.
- [ ] DevTools Network panel on a Google results page: no requests from the extension.
