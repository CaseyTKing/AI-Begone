#!/usr/bin/env node
/*
 * Writes the Google Search host permissions and content-script matches into
 * manifest.json from src/sites/google/domains.txt.
 *
 * Match patterns can't wildcard a TLD (https://www.google.* is invalid), so
 * every country domain is listed explicitly, for both www. and bare hosts.
 *
 * Usage: node scripts/generate-domains.js [--check]
 *   --check  exit 1 if manifest.json is out of date, without writing.
 *
 * Only patterns for Google hosts are replaced; other sites' entries in
 * host_permissions are kept. The Google content-script entry is the one that
 * loads src/sites/google/rules.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOMAINS_FILE = path.join(ROOT, 'src/sites/google/domains.txt');
const MANIFEST_FILE = path.join(ROOT, 'manifest.json');
const RULES_SCRIPT = 'src/sites/google/rules.js';
const PATH_PATTERN = '/search*';
const GOOGLE_PATTERN = /^https:\/\/(www\.)?google\.[a-z.]+\//;
const DOMAIN_RE = /^google\.([a-z]{2,3})(\.[a-z]{2})?$/;

function readDomains() {
  const lines = fs
    .readFileSync(DOMAINS_FILE, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith('#'));
  const seen = new Set();
  for (const domain of lines) {
    if (!DOMAIN_RE.test(domain)) throw new Error(`Invalid domain in domains.txt: "${domain}"`);
    if (seen.has(domain)) throw new Error(`Duplicate domain in domains.txt: "${domain}"`);
    seen.add(domain);
  }
  return lines;
}

function patternsFor(domains) {
  const out = [];
  for (const d of domains) {
    out.push(`https://www.${d}${PATH_PATTERN}`, `https://${d}${PATH_PATTERN}`);
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const patterns = patternsFor(readDomains());
  const raw = fs.readFileSync(MANIFEST_FILE, 'utf8');
  const manifest = JSON.parse(raw);

  const others = (manifest.host_permissions || []).filter((p) => !GOOGLE_PATTERN.test(p));
  manifest.host_permissions = [...others, ...patterns];

  const entry = (manifest.content_scripts || []).find((cs) => (cs.js || []).includes(RULES_SCRIPT));
  if (!entry) throw new Error(`No content_scripts entry loads ${RULES_SCRIPT}`);
  entry.matches = patterns;

  const next = JSON.stringify(manifest, null, 2) + '\n';
  if (check) {
    if (next !== raw) {
      console.error('manifest.json is out of date. Run: node scripts/generate-domains.js');
      process.exit(1);
    }
    console.log(`manifest.json is up to date (${patterns.length} patterns).`);
    return;
  }
  fs.writeFileSync(MANIFEST_FILE, next);
  console.log(`Wrote ${patterns.length} Google Search patterns to manifest.json.`);
}

main();
