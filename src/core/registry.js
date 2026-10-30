/*
 * Site registry and shared DOM helpers.
 *
 * A site module calls `NoAI.registerSite({ id, match, create })`:
 *   match(location) -> page type string (e.g. "web", "images") or null
 *   create(ctx)     -> { findRoot(), process(batch) }
 * See README "Adding a new site rule module".
 */
(function () {
  'use strict';

  const NoAI = (globalThis.NoAI = globalThis.NoAI || {});
  if (NoAI.registerSite) return;

  NoAI.sites = [];
  NoAI.registerSite = function registerSite(site) {
    if (!site || !site.id || typeof site.match !== 'function' || typeof site.create !== 'function') {
      throw new Error('[No AI] invalid site module');
    }
    NoAI.sites.push(site);
  };

  /** Attribute names used for marking. All styling keys off these. */
  const ATTR = Object.freeze({
    checked: 'data-noai-checked', // processed-node marker: "ai" | "pass"
    block: 'data-noai-block', // positively identified block, value = feature
    revealed: 'data-noai-revealed', // user chose to see it
    ui: 'data-noai-ui', // nodes we inserted; ignored by the observer
    aiImage: 'data-noai-ai-image', // "grid" | "panel"
    target: 'data-noai-target', // the <img> to blur
    pos: 'data-noai-pos', // we made this element position: relative
  });

  const selectorCache = new Map();

  /**
   * Join a list of selectors, dropping any the browser rejects, so one bad
   * entry in config can't break every rule. Returns null if none are valid.
   */
  function selector(list) {
    const cacheKey = list.join('\u0000');
    if (selectorCache.has(cacheKey)) return selectorCache.get(cacheKey);
    const probe = document.createDocumentFragment();
    const valid = list.filter((sel) => {
      try {
        probe.querySelector(sel);
        return true;
      } catch (_) {
        console.warn('[No AI] ignoring invalid selector:', sel);
        return false;
      }
    });
    const joined = valid.length ? valid.join(',') : null;
    selectorCache.set(cacheKey, joined);
    return joined;
  }

  /** Normalise text for display-independent comparison. */
  function normalize(text) {
    return String(text || '')
      .normalize('NFKC')
      .replace(/[‘’ʼ`´]/g, "'")
      .replace(/[‐-―−]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** Comparison key: normalised with all whitespace removed. */
  function textKey(text) {
    return normalize(text).replace(/\s+/g, '');
  }

  function pageLang() {
    return String(document.documentElement.getAttribute('lang') || '').toLowerCase();
  }

  const labelCache = new Map();

  /**
   * Label keys for the page language: exact tag (e.g. "pt-br"), then primary
   * subtag ("pt"), plus English, since Google often shows English product
   * names on localised pages. Matching is exact, so this stays safe.
   */
  function labelSet(labelsByLang) {
    const lang = pageLang();
    let perTable = labelCache.get(labelsByLang);
    if (!perTable) {
      perTable = new Map();
      labelCache.set(labelsByLang, perTable);
    }
    if (perTable.has(lang)) return perTable.get(lang);
    const langs = [lang, lang.split('-')[0], 'en'];
    const set = new Set();
    for (const l of langs) {
      for (const label of labelsByLang[l] || []) set.add(textKey(label));
    }
    perTable.set(lang, set);
    return set;
  }

  /** Elements in `scope` (array of elements) that match `sel`, incl. roots. */
  function queryAll(scope, sel) {
    if (!sel) return [];
    const out = new Set();
    for (const root of scope) {
      if (!root || root.nodeType !== 1) continue;
      if (root.matches(sel)) out.add(root);
      for (const el of root.querySelectorAll(sel)) out.add(el);
    }
    return [...out];
  }

  /** Nearest ancestor matching the earliest selector in `list` that matches. */
  function closestByPriority(el, list) {
    for (const sel of list) {
      const s = selector([sel]);
      const found = s && el.closest(s);
      if (found) return found;
    }
    return null;
  }

  function isOwnUi(el) {
    return !!(el && el.closest && el.closest('[' + ATTR.ui + ']'));
  }

  /**
   * Give `el` a containing block for an absolutely positioned overlay without
   * disturbing layout: only static elements are touched.
   */
  function ensurePositioned(el) {
    if (getComputedStyle(el).position === 'static') el.setAttribute(ATTR.pos, '');
  }

  NoAI.dom = {
    ATTR,
    selector,
    normalize,
    textKey,
    pageLang,
    labelSet,
    queryAll,
    closestByPriority,
    isOwnUi,
    ensurePositioned,
  };
})();
