/*
 * Settings model shared by the content script and the popup.
 *
 * Stored keys are the user's raw choices. The master switch never rewrites
 * individual toggles, so they survive master off -> on. `effective()` turns
 * raw settings into what each feature should actually do right now.
 */
(function () {
  'use strict';

  const NoAI = (globalThis.NoAI = globalThis.NoAI || {});
  if (NoAI.settings) return;

  const DEFAULTS = Object.freeze({
    master: true,
    overview: true,
    aiModeTab: true,
    images: true,
    imageMode: 'blur',
    imageQueryExclude: false,
    imageDebug: false,
  });

  const IMAGE_MODES = Object.freeze(['blur', 'hide']);
  const LOAD_TIMEOUT_MS = 1500;

  /** Coerce arbitrary stored data into a valid settings object. */
  function normalize(raw) {
    const out = { ...DEFAULTS };
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(DEFAULTS)) {
        if (typeof raw[key] === typeof DEFAULTS[key]) out[key] = raw[key];
      }
    }
    if (!IMAGE_MODES.includes(out.imageMode)) out.imageMode = DEFAULTS.imageMode;
    return out;
  }

  /** What each feature should do, after applying the master switch. */
  function effective(s) {
    return {
      overview: s.master && s.overview,
      aiMode: s.master && s.aiModeTab,
      images: s.master && s.images ? s.imageMode : 'off',
      imageQueryExclude: !!(s.master && s.images && s.imageQueryExclude),
      imageDebug: !!s.imageDebug,
    };
  }

  /**
   * Read settings. Never rejects: if storage is unreadable or slow, resolve
   * with the install defaults so the page is still handled.
   */
  function load() {
    const read = NoAI.platform.storage.get({ ...DEFAULTS }).then(normalize);
    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
    });
    return Promise.race([read, timeout])
      .then((s) => s || { ...DEFAULTS })
      .catch(() => ({ ...DEFAULTS }));
  }

  function save(partial) {
    return NoAI.platform.storage.set(partial);
  }

  /** Call `listener(nextSettings)` whenever stored settings change. */
  function watch(initial, listener) {
    let current = normalize(initial);
    return NoAI.platform.storage.onChanged((changes) => {
      const next = { ...current };
      let touched = false;
      for (const key of Object.keys(changes)) {
        if (!(key in DEFAULTS)) continue;
        next[key] = changes[key] === undefined ? DEFAULTS[key] : changes[key];
        touched = true;
      }
      if (!touched) return;
      current = normalize(next);
      listener(current);
    });
  }

  NoAI.settings = { DEFAULTS, IMAGE_MODES, normalize, effective, load, save, watch };
})();
