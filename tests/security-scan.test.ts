import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Release-verification secret scan (runs in `npm test`).
 * Covers tracked files only — what would actually be published or deployed.
 * Patterns are high-signal credential shapes; any hit fails the suite.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Bearer [A-Za-z0-9._-]{24,}/,
];
const SKIP = /(^|\/)(node_modules|dist|\.next|\.git)\//;
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|jsonc|md|yml|yaml|txt|css|html|py|ps1)$/;

function trackedFiles(): string[] {
  try {
    return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

test('no credential-shaped secrets in any tracked file', () => {
  const files = trackedFiles();
  assert.ok(files.length > 100, 'expected the tracked file list');
  const hits: string[] = [];
  for (const f of files) {
    if (SKIP.test(f) || !TEXT_EXT.test(f)) continue;
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const p of SECRET_PATTERNS) if (p.test(text)) hits.push(`${f}: ${p}`);
  }
  assert.deepEqual(hits, []);
});

test('no env/credential files are tracked; example template carries no value', () => {
  const files = trackedFiles();
  const bad = files.filter(f => /(^|\/)(\.env($|\.)|\.dev\.vars|credentials?\.|.*\.pem$|.*\.key$)/.test(f) && f !== '.env.example');
  assert.deepEqual(bad, []);
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  assert.ok(!/MODEL_API_KEY=\S+/.test(example), '.env.example must not contain a key value');
  const wrangler = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
  assert.ok(!/"MODEL_API_KEY"\s*:/.test(wrangler), 'the Meta key must be a Worker secret, never a wrangler var');
});

test('Meta inference is server-side only: no client code touches the provider or the key', () => {
  const files = trackedFiles().filter(f => f.startsWith('app/') && /\.(ts|tsx)$/.test(f));
  const offenders = files.filter(f => {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return /api\.meta\.ai|MODEL_API_KEY|META_API_KEY/.test(text) && !f.startsWith('app/api/');
  });
  assert.deepEqual(offenders, []);
  // The browser Copilot must call ARIQ's own protected route, never Meta.
  const ui = fs.readFileSync(path.join(ROOT, 'app/copilot/Copilot.tsx'), 'utf8');
  assert.ok(ui.includes("fetch('/api/copilot'") || ui.includes('fetch("/api/copilot"') || ui.includes("fetch('/api/copilot',") || ui.includes("'/api/copilot'"));
  assert.ok(!/api\.meta\.ai/.test(ui));
});
