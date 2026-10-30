/*
 * Platform wrapper.
 *
 * This is the ONLY file that touches the browser extension API namespace
 * (`chrome.*`). Feature code talks to `NoAI.platform` instead, so adding
 * Firefox or Edge means changing this file only. See README "Adding Firefox /
 * Edge support".
 *
 * Loaded as a classic script in both the content-script world and the popup.
 */
(function () {
  'use strict';

  const NoAI = (globalThis.NoAI = globalThis.NoAI || {});
  if (NoAI.platform) return;

  // Chrome exposes `chrome`; Firefox exposes promise-based `browser` (and a
  // `chrome` alias). Prefer `browser` when present so promises are native.
  const api = globalThis.browser || globalThis.chrome || null;
  const AREA = 'sync';

  function storageArea() {
    if (!api || !api.storage || !api.storage[AREA]) {
      throw new Error('storage.' + AREA + ' is unavailable');
    }
    return api.storage[AREA];
  }

  NoAI.platform = {
    name: globalThis.browser ? 'webextension' : 'chrome',

    storage: {
      /** Resolve with stored values, falling back to `defaults` per key. */
      get(defaults) {
        try {
          return Promise.resolve(storageArea().get(defaults));
        } catch (err) {
          return Promise.reject(err);
        }
      },

      /** Persist a partial settings object. */
      set(values) {
        try {
          return Promise.resolve(storageArea().set(values));
        } catch (err) {
          return Promise.reject(err);
        }
      },

      /**
       * Subscribe to changes in the settings area. The listener receives a
       * flat `{ key: newValue }` object (newValue is undefined if removed).
       * Returns an unsubscribe function.
       */
      onChanged(listener) {
        if (!api || !api.storage || !api.storage.onChanged) return () => {};
        const handler = (changes, areaName) => {
          if (areaName !== AREA) return;
          const flat = {};
          for (const key of Object.keys(changes)) flat[key] = changes[key].newValue;
          listener(flat);
        };
        try {
          api.storage.onChanged.addListener(handler);
        } catch (_) {
          // Extension context invalidated (e.g. extension reloaded).
          return () => {};
        }
        return () => {
          try {
            api.storage.onChanged.removeListener(handler);
          } catch (_) { /* context gone */ }
        };
      },
    },
  };
})();
