/*
 * Google Search rule module.
 *
 * Every rule follows the same contract: identify positively (stable
 * attribute or exact localized label), mark with data-noai-* attributes, and
 * let styles.css do the hiding based on the per-feature state on <html>. If
 * nothing matches, nothing happens.
 */
(function () {
  'use strict';

  const NoAI = globalThis.NoAI;
  const config = NoAI.config.google;
  const dom = NoAI.dom;
  const A = dom.ATTR;
  const sel = dom.selector;

  function match(loc) {
    if (!/^(www\.)?google\.[a-z.]+$/i.test(loc.hostname)) return null;
    if (loc.pathname !== '/search') return null;
    const params = new URLSearchParams(loc.search);
    const udm = params.get('udm');
    const tbm = params.get('tbm');
    if (config.pages.skip.udm.includes(udm)) return null;
    if (config.pages.images.udm.includes(udm) || config.pages.images.tbm.includes(tbm)) return 'images';
    if (!udm && !tbm) return 'web';
    return 'other'; // News, Videos, etc.: only the AI Mode tab applies.
  }

  /** True if the element's text or accessible name is exactly a label. */
  function matchesLabel(el, labels, maxLength) {
    const text = el.textContent;
    if (text && text.length <= maxLength && labels.has(dom.textKey(text))) return true;
    const aria = el.getAttribute('aria-label');
    return !!(aria && labels.has(dom.textKey(aria)));
  }

  const PAGE_FEATURES = {
    web: ['overview', 'aiMode', 'images'],
    images: ['aiMode', 'images'],
    other: ['aiMode'],
  };

  function create(ctx) {
    const overview = createOverviewRule(ctx);
    const aiMode = createAiModeRule();
    const images = createImageRule(ctx);
    let queryExclusionDone = false;

    function applyQueryExclusion() {
      const eff = ctx.effective;
      if (!eff || !eff.imageQueryExclude) return;
      const terms = config.queryExcludeTerms;
      if (!terms || !terms.length) return;
      const params = new URLSearchParams(location.search);
      const q = params.get('q');
      if (!q) return;
      const qLower = q.toLowerCase();
      const missing = terms.filter((t) => !qLower.includes(t.toLowerCase()));
      if (!missing.length) return;
      params.set('q', q + ' ' + missing.join(' '));
      location.replace(location.pathname + '?' + params.toString() + (location.hash || ''));
    }

    return {
      // Features that exist on this page; core forces the rest off.
      features: PAGE_FEATURES[ctx.page] || [],

      findRoot() {
        for (const s of config.roots[ctx.page] || []) {
          const el = document.querySelector(s);
          if (el) return el;
        }
        return null;
      },

      start() {
        applyQueryExclusion();
        queryExclusionDone = true;
      },

      process({ nodes, full }) {
        const eff = ctx.effective;
        if (!queryExclusionDone) {
          queryExclusionDone = true;
          applyQueryExclusion();
        }
        if (eff.overview) overview.scan(nodes, full);
        if (eff.aiMode) aiMode.scan();
        if (eff.images !== 'off') images.scan(nodes, full);
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* AI Overview                                                         */
  /* ------------------------------------------------------------------ */

  function createOverviewRule(ctx) {
    const cfg = config.overview;
    const blocked = new Map(); // container -> toggle button
    const pending = new Map(); // flash-guard candidate -> first seen (ms)
    let pendingTimer = 0;
    let idCounter = 0;

    const candidateSel = sel(cfg.candidateSelectors);
    const headingSel = sel(cfg.headingSelectors);
    const columnSel = sel(cfg.columnSelectors);
    const excludeSel = sel(cfg.mustNotContain);

    function labels() {
      return dom.labelSet(cfg.labels);
    }

    function isSafeBlock(el) {
      if (!el || el === document.body || el === document.documentElement) return false;
      if (excludeSel && (el.matches(excludeSel) || el.querySelector(excludeSel))) return false;
      return true;
    }

    /** Climb from the heading to the direct child of a result column. */
    function resolveContainer(heading) {
      if (!columnSel) return null;
      let el = heading;
      for (let depth = 0; depth < cfg.maxClimb; depth++) {
        const parent = el.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) return null;
        if (parent.matches(columnSel)) {
          return el !== heading && isSafeBlock(el) ? el : null;
        }
        el = parent;
      }
      return null;
    }

    /** First heading inside `root` whose text is an overview label. */
    function findLabel(root) {
      if (!headingSel) return null;
      const set = labels();
      for (const h of root.querySelectorAll(headingSel)) {
        if (!h.closest('a') && matchesLabel(h, set, 120)) return h;
      }
      return null;
    }

    function overlapsBlocked(el) {
      for (const container of blocked.keys()) {
        if (container === el || container.contains(el) || el.contains(container)) return true;
      }
      return false;
    }

    function block(container) {
      if (overlapsBlocked(container)) return;
      container.setAttribute(A.block, 'overview');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'noai-overview-toggle';
      btn.setAttribute(A.ui, '');
      btn.setAttribute('aria-expanded', 'false');
      if (!container.id) container.id = 'noai-overview-' + ++idCounter;
      btn.setAttribute('aria-controls', container.id);
      btn.textContent = config.ui.showOverview;
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = btn.getAttribute('aria-expanded') !== 'true';
        container.toggleAttribute(A.revealed, open);
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = open ? config.ui.hideOverview : config.ui.showOverview;
      });

      container.before(btn);
      blocked.set(container, btn);
    }

    /** Keep each toggle directly before its block; Google may re-render. */
    function maintain() {
      for (const [container, btn] of blocked) {
        if (!container.isConnected) {
          btn.remove();
          blocked.delete(container);
        } else if (btn.nextElementSibling !== container) {
          container.before(btn);
        }
      }
    }

    function checkCandidates(scope) {
      const now = performance.now();
      for (const cand of dom.queryAll(scope, candidateSel)) {
        if (!cand.hasAttribute(A.checked) && !pending.has(cand)) pending.set(cand, now);
      }
      for (const [cand, since] of pending) {
        if (!cand.isConnected) {
          pending.delete(cand);
          continue;
        }
        const heading = findLabel(cand);
        if (heading) {
          heading.setAttribute(A.checked, 'ai');
          const container = resolveContainer(heading) || (isSafeBlock(cand) ? cand : null);
          if (container) block(container);
          cand.setAttribute(A.checked, container ? 'ai' : 'pass');
          pending.delete(cand);
        } else if (now - since >= cfg.pendingTimeoutMs) {
          // Couldn't identify it: release the flash guard and leave it alone.
          cand.setAttribute(A.checked, 'pass');
          pending.delete(cand);
        }
      }
      if (pending.size && !pendingTimer) {
        pendingTimer = setTimeout(() => {
          pendingTimer = 0;
          ctx.poke();
        }, cfg.pendingTimeoutMs);
      }
    }

    function checkHeadings(scope, full) {
      if (!headingSel) return;
      const set = labels();
      const headings = new Set(dom.queryAll(scope, headingSel));
      if (!full) {
        // Text streamed into an existing heading: the added node is inside it.
        for (const node of scope) {
          const h = node.closest(headingSel);
          if (h) headings.add(h);
        }
      }
      for (const h of headings) {
        if (h.hasAttribute(A.checked) || h.closest('a') || dom.isOwnUi(h)) continue;
        if (!matchesLabel(h, set, 120)) continue;
        h.setAttribute(A.checked, 'ai');
        const container = resolveContainer(h);
        if (container) block(container);
      }
    }

    return {
      scan(scope, full) {
        if (candidateSel) checkCandidates(scope);
        checkHeadings(scope, full);
        maintain();
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* AI Mode tab / button                                                */
  /* ------------------------------------------------------------------ */

  function createAiModeRule() {
    const cfg = config.aiMode;
    const regionSel = sel(cfg.regionSelectors);
    const linkSel = sel(cfg.linkSelectors);
    const labelElSel = sel(cfg.labelElementSelectors);
    const controlSel = sel(['a', 'button', '[role="link"]', '[role="button"]', '[role="tab"]']);

    function hide(el, region) {
      el.setAttribute(A.checked, 'ai');
      let target = el;
      const item = dom.closestByPriority(el, cfg.itemSelectors);
      if (item && region.contains(item) && item !== region && item.querySelectorAll(controlSel).length <= 1) {
        target = item;
      }
      target.setAttribute(A.block, 'aimode');
    }

    return {
      // The header is small and usually outside the observed results root,
      // so it's scanned directly each pass; markers keep this cheap.
      scan() {
        if (!regionSel) return;
        const labels = dom.labelSet(cfg.labels);
        for (const region of document.querySelectorAll(regionSel)) {
          if (linkSel) {
            for (const el of region.querySelectorAll(linkSel)) {
              if (!el.hasAttribute(A.checked)) hide(el, region);
            }
          }
          if (labelElSel) {
            for (const el of region.querySelectorAll(labelElSel)) {
              if (el.hasAttribute(A.checked) || dom.isOwnUi(el)) continue;
              if (matchesLabel(el, labels, 40)) hide(el, region);
              else if (el.textContent.trim()) el.setAttribute(A.checked, 'pass');
            }
          }
        }
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* AI-labelled images                                                  */
  /* ------------------------------------------------------------------ */

  function createImageRule(ctx) {
    const cfg = config.images;
    const sources = NoAI.config.aiImageSources || { domains: [], keywords: [] };
    const itemSel = sel(cfg.gridItemSelectors);
    const panelSel = sel(cfg.panelSelectors);
    const thumbSel = sel(cfg.thumbSelectors);
    const panelImgSel = cfg.panelImageSelectors;
    const attrSel = sel(cfg.labelAttributes.map((a) => '[' + a + ']'));
    const kwAttrSel = sel(cfg.keywordAttributes.map((a) => '[' + a + ']'));
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

    // Pre-lowercase keywords and domains once.
    const kwList = (sources.keywords || []).map((k) => k.toLowerCase());
    const domainList = sources.domains || [];

    function debug(rule, detail, item) {
      if (ctx.effective && ctx.effective.imageDebug) {
        const id = item.getAttribute('data-docid') || item.getAttribute('data-ri') || item.id || '?';
        console.debug('[No AI] image hidden | rule:', rule, '| signal:', detail, '| card:', id, item);
      }
    }

    /** Extract source hostnames from all link-like attributes in an item. */
    function getSourceHostnames(item) {
      const hostnames = new Set();
      for (const a of item.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href');
        if (!href || href.startsWith('/') || href.startsWith('#')) continue;
        try {
          hostnames.add(new URL(href).hostname.toLowerCase());
        } catch (_) {}
      }
      for (const el of [item, ...item.querySelectorAll('[data-lpage]')]) {
        const v = el.getAttribute('data-lpage');
        if (!v) continue;
        try {
          hostnames.add(new URL(v).hostname.toLowerCase());
        } catch (_) {}
      }
      return hostnames;
    }

    /** Check item links against known AI domains. Returns signal or null. */
    function checkDomain(item) {
      if (!cfg.domainDetection || !domainList.length) return null;
      const hostnames = getSourceHostnames(item);
      for (const host of hostnames) {
        for (const domain of domainList) {
          if (host === domain || host.endsWith('.' + domain)) {
            return { rule: 'domain', detail: domain };
          }
        }
      }
      return null;
    }

    /** Check alt/title/aria-label attributes for known AI keywords. */
    function checkKeywords(item) {
      if (!cfg.keywordDetection || !kwList.length || !kwAttrSel) return null;
      const els = [item, ...item.querySelectorAll(kwAttrSel)];
      for (const el of els) {
        for (const attr of cfg.keywordAttributes) {
          const v = el.getAttribute(attr);
          if (!v || v.length > 300) continue;
          const lv = v.toLowerCase();
          for (const kw of kwList) {
            if (lv.includes(kw)) {
              return { rule: 'keyword', detail: `"${kw}" in ${attr}` };
            }
          }
        }
      }
      return null;
    }

    const elementKeys = new WeakMap(); // marked element -> Set of image keys
    const revealedKeys = new Set();
    const panels = new Map(); // panel -> { host, img, src, keys }

    const panelImgJoined = sel(panelImgSel);

    /**
     * The grid card containing `el`, or null. Inside a panel, a wrapper that
     * holds the panel's main image is the viewer, not a related-image card.
     */
    function gridItemFor(el) {
      const item = dom.closestByPriority(el, cfg.gridItemSelectors);
      if (!item) return null;
      const panel = panelSel && item.closest(panelSel);
      if (panel && panelImgJoined && item.querySelector(panelImgJoined)) return null;
      return item;
    }

    function inGridItem(el, within) {
      const item = gridItemFor(el);
      return !!(item && (!within || within.contains(item)));
    }

    function hiddenFromUser(el) {
      return !!el.closest('[aria-hidden="true"]');
    }

    /** Elements under `scope` whose text or accessible name is an AI label. */
    function findLabels(scope) {
      const labels = dom.labelSet(cfg.labels);
      const max = cfg.maxLabelLength;
      const hits = [];
      const seen = new Set();
      for (const root of scope) {
        if (!root || root.nodeType !== 1) continue;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const p = node.parentElement;
          if (!p || seen.has(p)) continue;
          seen.add(p);
          if (SKIP_TAGS.has(p.tagName) || node.data.length > max) continue;
          const text = p.textContent;
          if (text.length <= max && labels.has(dom.textKey(text)) && !dom.isOwnUi(p)) hits.push(p);
        }
        for (const el of dom.queryAll([root], attrSel)) {
          if (dom.isOwnUi(el)) continue;
          for (const attr of cfg.labelAttributes) {
            const v = el.getAttribute(attr);
            if (v && v.length <= max && labels.has(dom.textKey(v))) {
              hits.push(el);
              break;
            }
          }
        }
      }
      return hits;
    }

    function largestImage(root, exclude) {
      let best = null;
      let bestArea = 0;
      for (const img of root.querySelectorAll('img')) {
        if (exclude && exclude(img)) continue;
        const r = img.getBoundingClientRect();
        const area = r.width * r.height || img.naturalWidth * img.naturalHeight;
        if (area > bestArea) {
          best = img;
          bestArea = area;
        }
      }
      return best;
    }

    function srcOf(img) {
      return img.currentSrc || img.getAttribute('src') || '';
    }

    function keysFor(el, img) {
      const keys = new Set();
      for (const attr of cfg.linkAttributes) {
        const holders = [el, ...el.querySelectorAll('[' + attr + ']')];
        for (const h of holders) {
          const v = h.getAttribute(attr);
          if (v) keys.add(attr + ':' + v);
        }
      }
      if (img && srcOf(img)) keys.add('src:' + srcOf(img));
      return keys;
    }

    /** Host for the overlay: the image's nearest box-generating parent. */
    function overlayHost(img, limit) {
      let host = img.parentElement;
      while (host && host !== limit) {
        const display = getComputedStyle(host).display;
        if (display !== 'inline' && display !== 'contents') break;
        host = host.parentElement;
      }
      return host || img.parentElement;
    }

    function addOverlay(host, marked) {
      dom.ensurePositioned(host);
      const overlay = document.createElement('div');
      overlay.className = 'noai-image-overlay';
      overlay.setAttribute(A.ui, '');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'noai-image-reveal';
      btn.textContent = config.ui.showImage;
      btn.setAttribute('aria-label', config.ui.showImageAria);
      // Keep Google's delegated handlers from opening the image.
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'keydown']) {
        btn.addEventListener(type, (e) => e.stopPropagation());
      }
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        reveal(marked);
      });
      overlay.appendChild(btn);
      host.appendChild(overlay);
      return overlay;
    }

    /** Reveal one image, plus its grid/panel twin (same image keys). */
    function reveal(marked) {
      const keys = elementKeys.get(marked) || new Set();
      for (const k of keys) revealedKeys.add(k);
      marked.setAttribute(A.revealed, '');
      if (!keys.size) return;
      for (const el of document.querySelectorAll('[' + A.aiImage + ']:not([' + A.revealed + '])')) {
        const other = elementKeys.get(el);
        if (other && [...other].some((k) => keys.has(k))) el.setAttribute(A.revealed, '');
      }
    }

    function applyRevealed(el, keys) {
      if ([...keys].some((k) => revealedKeys.has(k))) el.setAttribute(A.revealed, '');
    }

    function markGridItem(item, signal) {
      if (item.hasAttribute(A.aiImage)) return;
      const img = (thumbSel && item.querySelector(thumbSel)) || largestImage(item);
      if (!img) return; // Nothing we can treat: leave the card alone.
      const keys = keysFor(item, img);
      item.setAttribute(A.aiImage, 'grid');
      img.setAttribute(A.target, '');
      elementKeys.set(item, keys);
      applyRevealed(item, keys);
      addOverlay(overlayHost(img, item), item);
      if (signal) debug(signal.rule, signal.detail, item);
    }

    function findPanelImage(panel) {
      const usable = (img) => !inGridItem(img, panel) && !hiddenFromUser(img) && !dom.isOwnUi(img);
      for (const s of panelImgSel) {
        const valid = sel([s]);
        if (!valid) continue;
        for (const img of panel.querySelectorAll(valid)) if (usable(img)) return img;
      }
      const img = largestImage(panel, (i) => !usable(i));
      if (!img) return null;
      const r = img.getBoundingClientRect();
      const min = cfg.panelMinImageSize;
      return r.width >= min && r.height >= min ? img : null;
    }

    function clearPanel(panel) {
      const state = panels.get(panel);
      if (!state) return;
      state.host.removeAttribute(A.aiImage);
      state.host.removeAttribute(A.revealed);
      state.host.removeAttribute(A.pos);
      state.img.removeAttribute(A.target);
      state.overlay.remove();
      panels.delete(panel);
    }

    function panelKeys(panel, img) {
      const keys = new Set();
      for (const attr of cfg.linkAttributes) {
        const holders = [panel, ...panel.querySelectorAll('[' + attr + ']')];
        for (const h of holders) {
          if (h !== panel && inGridItem(h, panel)) continue;
          const v = h.getAttribute(attr);
          if (v) keys.add(attr + ':' + v);
        }
      }
      const params = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1));
      for (const name of cfg.linkUrlParams) {
        const v = params.get(name);
        if (v) for (const attr of cfg.linkAttributes) keys.add(attr + ':' + v);
      }
      if (srcOf(img)) keys.add('src:' + srcOf(img));
      return keys;
    }

    /** Apply a panel-only label to the matching grid card, if we can find it. */
    function linkGrid(panel, keys) {
      if (!itemSel || !keys.size) return;
      for (const item of document.querySelectorAll(itemSel)) {
        if (panel.contains(item) || item.hasAttribute(A.aiImage)) continue;
        const thumb = (thumbSel && item.querySelector(thumbSel)) || largestImage(item);
        const itemKeys = keysFor(item, thumb);
        if ([...itemKeys].some((k) => keys.has(k))) markGridItem(item);
      }
    }

    /** Panels are reused for different images, so re-evaluate from scratch. */
    function evaluatePanel(panel) {
      if (hiddenFromUser(panel)) {
        clearPanel(panel);
        return;
      }
      const isAi = findLabels([panel]).some((el) => !inGridItem(el, panel) && !hiddenFromUser(el));
      const img = isAi ? findPanelImage(panel) : null;
      const state = panels.get(panel);
      if (!img) {
        clearPanel(panel);
        return;
      }
      if (state && state.img === img && state.src === srcOf(img) && state.host.isConnected) return;
      clearPanel(panel);

      const host = overlayHost(img, panel);
      const keys = panelKeys(panel, img);
      host.setAttribute(A.aiImage, 'panel');
      img.setAttribute(A.target, '');
      elementKeys.set(host, keys);
      applyRevealed(host, keys);
      const overlay = addOverlay(host, host);
      panels.set(panel, { host, img, src: srcOf(img), keys, overlay });
      linkGrid(panel, keys);
    }

    return {
      scan(scope, full) {
        const dirtyPanels = new Set(full && panelSel ? document.querySelectorAll(panelSel) : []);
        if (panelSel) {
          for (const node of scope) {
            const panel = node.closest(panelSel);
            if (panel) dirtyPanels.add(panel);
          }
          for (const panel of dom.queryAll(scope, panelSel)) dirtyPanels.add(panel);
        }
        for (const panel of panels.keys()) {
          if (!panel.isConnected) panels.delete(panel);
        }

        // Pass 1: Google's own AI labels (most reliable signal).
        for (const el of findLabels(scope)) {
          const panel = panelSel && el.closest(panelSel);
          if (panel && !inGridItem(el, panel)) continue; // handled by evaluatePanel
          const item = gridItemFor(el);
          if (item) markGridItem(item, { rule: 'google-label', detail: el.textContent.trim() || el.getAttribute('aria-label') || '' });
        }

        // Pass 2: domain and keyword detection on unmarked grid items.
        if ((cfg.domainDetection || cfg.keywordDetection) && itemSel) {
          const candidates = full
            ? document.querySelectorAll(itemSel)
            : dom.queryAll(scope, itemSel);
          for (const item of candidates) {
            if (item.hasAttribute(A.aiImage)) continue;
            const signal = checkDomain(item) || checkKeywords(item);
            if (signal) markGridItem(item, signal);
          }
        }

        for (const panel of dirtyPanels) evaluatePanel(panel);
      },
    };
  }

  NoAI.registerSite({ id: 'google', match, create });
})();
