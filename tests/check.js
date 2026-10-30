#!/usr/bin/env node
/*
 * Static checks, no dependencies: node tests/check.js
 *   - config.js is well-formed, has every required language, and a valid
 *     lastVerified date
 *   - styles.css flash-guard selectors mirror config.js
 *   - settings defaults and master-switch logic
 *   - manifest permissions are minimal and domain patterns are current
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const REQUIRED_LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ja', 'hi'];

function load(files) {
  const sandbox = { console, setTimeout, Promise };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(read(f), sandbox, { filename: f });
  return sandbox.NoAI;
}

const results = [];
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push(['PASS', name]))
    .catch((err) => results.push(['FAIL', name + ' :: ' + err.message]));
}

(async () => {
  const NoAI = load(['src/sites/google/config.js']);
  const cfg = NoAI.config.google;
  const css = read('src/sites/google/styles.css');

  await test('config has version and ISO lastVerified date', () => {
    assert.ok(Number.isInteger(cfg.version) && cfg.version > 0);
    assert.match(cfg.lastVerified, /^\d{4}-\d{2}-\d{2}$/);
  });

  await test('every label table covers the required languages', () => {
    for (const feature of ['overview', 'aiMode', 'images']) {
      for (const lang of REQUIRED_LANGS) {
        const list = cfg[feature].labels[lang];
        assert.ok(Array.isArray(list) && list.length, `${feature}.labels.${lang} missing`);
      }
    }
  });

  await test('styles.css flash guard mirrors config selectors', () => {
    for (const s of [...cfg.overview.candidateSelectors, ...cfg.aiMode.linkSelectors]) {
      assert.ok(css.includes(s), `styles.css is missing "${s}"`);
    }
    for (const s of cfg.aiMode.regionSelectors) {
      assert.ok(css.includes(s), `styles.css AI Mode region list is missing "${s}"`);
    }
  });

  const S = load(['src/platform/browser.js', 'src/core/settings.js']).settings;

  await test('install defaults', () => {
    assert.deepStrictEqual({ ...S.DEFAULTS }, {
      master: true, overview: true, aiModeTab: true, images: true, imageMode: 'blur',
    });
  });

  await test('master off disables everything without touching toggles', () => {
    const s = { ...S.DEFAULTS, master: false };
    assert.deepStrictEqual({ ...S.effective(s) }, { overview: false, aiMode: false, images: 'off' });
    assert.strictEqual(s.overview, true);
    const back = S.effective({ ...s, master: true, aiModeTab: false, imageMode: 'hide' });
    assert.deepStrictEqual({ ...back }, { overview: true, aiMode: false, images: 'hide' });
  });

  await test('normalize rejects bad values', () => {
    const n = S.normalize({ master: 'yes', imageMode: 'pixelate', extra: 1 });
    assert.strictEqual(n.master, true);
    assert.strictEqual(n.imageMode, 'blur');
    assert.ok(!('extra' in n));
  });

  await test('load() falls back to defaults when storage is unavailable', async () => {
    const s = await S.load(); // no chrome.* in this sandbox
    assert.deepStrictEqual({ ...s }, { ...S.DEFAULTS });
  });

  await test('manifest permissions are minimal', () => {
    const m = JSON.parse(read('manifest.json'));
    assert.deepStrictEqual(m.permissions, ['storage']);
    assert.ok(!m.optional_permissions && !m.background && !m.web_accessible_resources);
    assert.ok(m.host_permissions.every((p) => /^https:\/\/(www\.)?google\.[a-z.]+\/search\*$/.test(p)));
    assert.strictEqual(m.minimum_chrome_version, '116');
    assert.strictEqual(m.content_scripts[0].run_at, 'document_start');
  });

  await test('manifest domain patterns match domains.txt', () => {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/generate-domains.js'), '--check'], { stdio: 'pipe' });
  });

  await test('no network or remote-code APIs in extension source', () => {
    const banned = /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|eval)\s*\(|new Function\(/;
    const files = ['src/platform/browser.js', 'src/core/settings.js', 'src/core/registry.js', 'src/core/observer.js',
      'src/core/apply.js', 'src/sites/google/config.js', 'src/sites/google/rules.js', 'src/popup/popup.js'];
    for (const f of files) assert.ok(!banned.test(read(f)), `${f} uses a banned API`);
  });

  for (const [status, name] of results) console.log(`${status} ${name}`);
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
