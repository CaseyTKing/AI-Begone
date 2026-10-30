#!/usr/bin/env node
/*
 * Runs the fixture assertions (?autotest) in headless Chromium over the
 * DevTools protocol. Needs Node 22+ (built-in WebSocket) and Chrome,
 * Chromium or Brave. Usage: node tests/run-fixtures.js [--dark]
 * Set CHROME=/path/to/browser to choose a binary.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = ['google-web-ai-overview.html', 'google-images-labelled.html'];
const PORT = 9300 + Math.floor(Math.random() * 500);
const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('browser did not start');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    ws.onerror = reject;
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res) => {
            pending.set(++id, res);
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => ws.close(),
      });
  });
}

async function main() {
  const bin = CANDIDATES.find((c) => fs.existsSync(c));
  if (!bin) {
    console.log('No Chrome/Chromium/Brave found; skipping fixture tests (set CHROME=...).');
    return 0;
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'noai-'));
  const browser = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    '--allow-file-access-from-files', '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' });

  let failures = 0;
  try {
    const cdp = await connect(await waitForTarget());
    await cdp.send('Page.enable');
    if (process.argv.includes('--dark')) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    }
    for (const name of FIXTURES) {
      const url = 'file://' + path.join(ROOT, 'tests/fixtures', name) + '?autotest';
      await cdp.send('Page.navigate', { url });
      let text = '';
      for (let i = 0; i < 80 && !/RESULT:/.test(text); i++) {
        await sleep(250);
        const r = await cdp.send('Runtime.evaluate', {
          expression: "(document.getElementById('noai-test-results')||{}).textContent||''",
          returnByValue: true,
        });
        text = (r.result && r.result.result && r.result.result.value) || '';
      }
      console.log(`\n== ${name}\n${text || 'FAIL no results (timed out)'}`);
      if (!/RESULT: all passed/.test(text)) failures++;
    }
    cdp.close();
  } finally {
    browser.kill();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return failures ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
