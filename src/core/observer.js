/*
 * One MutationObserver per page, batched to animation frames.
 *
 * Observes the site's results container once it exists, falling back to
 * <body> (or <html> at document_start). Added nodes are collected and handed
 * to the site rules once per frame, before paint, so treatments land without
 * a visible flash. Our own inserted UI is ignored.
 */
(function () {
  'use strict';

  const NoAI = (globalThis.NoAI = globalThis.NoAI || {});
  if (NoAI.createObserver) return;

  const OPTIONS = { childList: true, subtree: true };

  NoAI.createObserver = function createObserver({ findRoot, process }) {
    const { isOwnUi } = NoAI.dom;
    let target = null;
    let observingRoot = false;
    let pending = new Set();
    let fullScan = false;
    let scheduled = false;

    const mo = new MutationObserver(collect);

    function collect(records) {
      for (const record of records) {
        for (const node of record.addedNodes) {
          const el = node.nodeType === 1 ? node : node.parentElement;
          if (el && !isOwnUi(el)) pending.add(el);
        }
      }
      if (pending.size) schedule();
    }

    /** (Re)attach to the best available root. Returns true if it moved. */
    function attach() {
      if (target && target.isConnected && observingRoot) return false;
      const root = findRoot();
      const next = root || document.body || document.documentElement;
      if (next === target && target.isConnected) return false;
      collect(mo.takeRecords());
      mo.disconnect();
      mo.observe(next, OPTIONS);
      target = next;
      observingRoot = !!root;
      return true;
    }

    /** Drop nodes whose ancestor is also pending; they'd be scanned twice. */
    function topLevel(nodes) {
      const out = [];
      for (const node of nodes) {
        if (!node.isConnected) continue;
        let p = node.parentElement;
        let covered = false;
        while (p) {
          if (nodes.has(p)) {
            covered = true;
            break;
          }
          p = p.parentElement;
        }
        if (!covered) out.push(node);
      }
      return out;
    }

    function flush() {
      scheduled = false;
      if (attach()) fullScan = true;
      const full = fullScan;
      const nodes = full ? [target] : topLevel(pending);
      pending = new Set();
      fullScan = false;
      try {
        process({ nodes, full, root: target });
      } catch (err) {
        console.warn('[No AI] processing failed; page left as-is.', err);
      }
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(flush);
    }

    return {
      start() {
        attach();
        fullScan = true;
        schedule();
      },
      /** Re-scan everything under the root on the next frame. */
      rescan() {
        fullScan = true;
        schedule();
      },
      /** Run rules on the next frame even if nothing was added. */
      poke() {
        schedule();
      },
      stop() {
        mo.disconnect();
      },
    };
  };
})();
