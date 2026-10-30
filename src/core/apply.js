/*
 * Content-script entry point. Loaded last.
 *
 * 1. Pick the site module whose `match(location)` returns a page type.
 * 2. Read settings (defaults if unreadable) and write per-feature state onto
 *    <html> as data attributes. The static stylesheet keys off these, so
 *    toggling a feature is a pure attribute change: instant, no reload.
 * 3. Start the observer, which feeds added nodes to the site rules.
 */
(function () {
  'use strict';

  const NoAI = globalThis.NoAI;
  if (!NoAI || NoAI.running) return;
  NoAI.running = true;

  const html = document.documentElement;
  if (!html) return;

  function writeAttributes(eff) {
    html.setAttribute('data-noai-overview', eff.overview ? 'on' : 'off');
    html.setAttribute('data-noai-aimode', eff.aiMode ? 'on' : 'off');
    html.setAttribute('data-noai-images', eff.images);
    html.setAttribute('data-noai-ready', '');
  }

  /** Release every flash guard and do nothing else. */
  function standDown() {
    writeAttributes({ overview: false, aiMode: false, images: 'off' });
  }

  function turnedOn(prev, next) {
    return (
      (!prev.overview && next.overview) ||
      (!prev.aiMode && next.aiMode) ||
      (prev.images === 'off' && next.images !== 'off') ||
      (!prev.imageQueryExclude && next.imageQueryExclude)
    );
  }

  try {
    // Test fixtures set `NoAI.testOverride = { site, page }` to run off-Google.
    const override = NoAI.testOverride;
    let site = null;
    let page = null;
    for (const candidate of NoAI.sites) {
      const type = override
        ? candidate.id === override.site ? override.page : null
        : candidate.match(location);
      if (type) {
        site = candidate;
        page = type;
        break;
      }
    }
    if (!site) {
      standDown();
      return;
    }

    let effective = null;
    let observer = null;

    const ctx = {
      page,
      get effective() {
        return effective;
      },
      rescan: () => observer && observer.rescan(),
      poke: () => observer && observer.poke(),
    };

    const rules = site.create(ctx);
    const supported = new Set(rules.features);

    /** Effective settings, with features this page doesn't have forced off. */
    function compute(settings) {
      const eff = NoAI.settings.effective(settings);
      return {
        overview: supported.has('overview') && eff.overview,
        aiMode: supported.has('aiMode') && eff.aiMode,
        images: supported.has('images') ? eff.images : 'off',
        imageQueryExclude: supported.has('images') && eff.imageQueryExclude,
        imageDebug: eff.imageDebug,
      };
    }

    observer = NoAI.createObserver({
      findRoot: () => rules.findRoot(),
      process: (batch) => rules.process(batch),
    });

    NoAI.settings
      .load()
      .then((settings) => {
        effective = compute(settings);
        writeAttributes(effective);
        observer.start();
        if (typeof rules.start === 'function') rules.start();

        NoAI.settings.watch(settings, (next) => {
          const prev = effective;
          effective = compute(next);
          writeAttributes(effective);
          // Features that were off were never scanned; catch up now.
          if (turnedOn(prev, effective)) observer.rescan();
        });
      })
      .catch((err) => {
        console.warn('[No AI] startup failed; page left as-is.', err);
        standDown();
      });
  } catch (err) {
    console.warn('[No AI] startup failed; page left as-is.', err);
    standDown();
  }
})();
