import test from 'node:test';
import assert from 'node:assert/strict';
import { copilotEnabled, POST as copilotPOST } from '../app/api/copilot/route.ts';
import { SOURCE_REGISTRY } from '../lib/data-refresh.ts';

test('Copilot route is disabled by default and requires explicit enablement plus a key', async () => {
  assert.equal(copilotEnabled({}), false);
  assert.equal(copilotEnabled({ ARIQ_COPILOT_ENABLED: 'true' }), false); // no key
  assert.equal(copilotEnabled({ META_API_KEY: 'x' }), false); // not enabled
  assert.equal(copilotEnabled({ ARIQ_COPILOT_ENABLED: 'true', META_API_KEY: 'x' }), true);
  assert.equal(copilotEnabled({ ARIQ_COPILOT_ENABLED: 'true', MODEL_API_KEY: 'x' }), true); // documented name in .env.example
  const res = await copilotPOST(new Request('http://127.0.0.1:3000/api/copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  assert.equal(res.status, 503);
  const body = await res.json() as { kind: string };
  assert.equal(body.kind, 'copilot-disabled');
});

test('refresh registry is a fixed https allowlist (SSRF guard surface)', () => {
  for (const s of SOURCE_REGISTRY) {
    const url = new URL(s.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.host, s.host);
  }
  const ids = SOURCE_REGISTRY.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});
