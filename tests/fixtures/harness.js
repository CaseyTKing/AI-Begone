/*
 * Fixture harness. NOT part of the extension.
 *
 * Lets the fixture pages run the real content scripts from a file:// URL:
 *   - fakes chrome.storage (sync + onChanged), persisted in sessionStorage
 *   - forces the Google site module on, with the page type from data-page
 *   - adds a settings panel (same keys as the popup) and fixture actions
 *   - ?storage=fail makes storage reads reject (tests the defaults fallback)
 *   - ?autotest runs window.fixtureTests and prints results into
 *     <pre id="noai-test-results">, for headless runs (see tests/run.sh)
 *
 * Must be loaded before src/platform/browser.js.
 */
(function () {
  'use strict';

  const script = document.currentScript;
  const params = new URLSearchParams(location.search);
  const KEY = 'noai-fixture-settings';
  const listeners = new Set();
  let store = {};
  try {
    store = JSON.parse(sessionStorage.getItem(KEY)) || {};
  } catch (_) { /* file:// may block storage */ }
  if (params.has('autotest')) store = {}; // tests always start from defaults

  function persist() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(store));
    } catch (_) { /* ignore */ }
  }

  globalThis.chrome = {
    runtime: {},
    storage: {
      sync: {
        get(defaults) {
          if (params.has('storage') && params.get('storage') === 'fail') {
            return Promise.reject(new Error('simulated storage failure'));
          }
          return Promise.resolve({ ...defaults, ...store });
        },
        set(values) {
          const changes = {};
          for (const k of Object.keys(values)) changes[k] = { oldValue: store[k], newValue: values[k] };
          Object.assign(store, values);
          persist();
          setTimeout(() => listeners.forEach((l) => l(changes, 'sync')), 0);
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (l) => listeners.add(l),
        removeListener: (l) => listeners.delete(l),
      },
    },
  };

  globalThis.NoAI = { testOverride: { site: 'google', page: script.dataset.page || 'web' } };

  /* ---- Helpers shared with fixture scripts ---- */

  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function settle(ms = 50) {
    await wait(ms);
    await frame();
    await frame();
  }
  function setSettings(values) {
    return globalThis.chrome.storage.sync.set(values).then(() => settle());
  }
  function isHidden(el) {
    return !el || getComputedStyle(el).display === 'none' || !el.getClientRects().length;
  }
  globalThis.fixture = { frame, wait, settle, setSettings, isHidden };

  /* ---- Settings panel ---- */

  const DEFAULTS = { master: true, overview: true, aiModeTab: true, images: true, imageMode: 'blur' };

  function buildPanel() {
    const panel = document.createElement('aside');
    panel.setAttribute('data-noai-ui', '');
    panel.setAttribute('aria-label', 'Fixture controls');
    panel.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:9999;width:230px;padding:10px 12px;' +
      'background:#fff;color:#222;border:1px solid #ccc;border-radius:10px;font:12px/1.5 system-ui;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.15)';
    const current = { ...DEFAULTS, ...store };
    const html = ['<strong>Fixture settings</strong>'];
    for (const key of ['master', 'overview', 'aiModeTab', 'images']) {
      html.push(`<label style="display:block"><input type="checkbox" data-k="${key}" ${current[key] ? 'checked' : ''}> ${key}</label>`);
    }
    html.push(
      `<label style="display:block">imageMode <select data-k="imageMode">` +
        ['blur', 'hide'].map((m) => `<option ${current.imageMode === m ? 'selected' : ''}>${m}</option>`).join('') +
        `</select></label>`
    );
    html.push('<hr style="border:0;border-top:1px solid #ddd">');
    panel.innerHTML = html.join('');
    panel.addEventListener('change', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      globalThis.chrome.storage.sync.set({ [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
    });
    for (const action of globalThis.fixtureActions || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.style.cssText = 'display:block;width:100%;margin:4px 0;text-align:left';
      b.addEventListener('click', action.run);
      panel.appendChild(b);
    }
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset settings + reload';
    reset.style.cssText = 'display:block;width:100%;margin:8px 0 0';
    reset.addEventListener('click', () => {
      store = {};
      persist();
      location.reload();
    });
    panel.appendChild(reset);
    document.body.appendChild(panel);
  }

  /* ---- Autotest runner ---- */

  async function runTests() {
    const out = document.createElement('pre');
    out.id = 'noai-test-results';
    out.setAttribute('data-noai-ui', '');
    document.body.appendChild(out);
    const lines = [];
    let failed = 0;
    await settle(100);
    for (const [name, fn] of globalThis.fixtureTests || []) {
      try {
        await fn();
        lines.push('PASS ' + name);
      } catch (err) {
        failed++;
        lines.push('FAIL ' + name + ' :: ' + (err && err.message));
      }
    }
    lines.push(failed ? `RESULT: ${failed} failed` : 'RESULT: all passed');
    out.textContent = lines.join('\n');
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (params.has('autotest')) {
      runTests();
    } else {
      buildPanel();
    }
  });
})();
