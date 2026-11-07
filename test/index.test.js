import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as host from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('dsh-spotlight host exports valid cordis plugin interface', () => {
  assert.equal(host.name, 'dsh-spotlight');
  assert.equal(typeof host.apply, 'function');
});

test('dsh-spotlight package.json configuration is valid', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dsh-spotlight');
  assert.equal(pkg.dsh?.client?.platform, 'web');
  assert.equal(pkg.dsh?.client?.immediately, true);
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-workspace'));
  assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-layout'));
});

test('dsh-spotlight cordis.patch.yml enables session-query-sqlite on first-search', () => {
  const patchCode = readFileSync(join(__dirname, '..', 'cordis.patch.yml'), 'utf8');
  assert.match(patchCode, /session-query-sqlite/);
  assert.match(patchCode, /openAt:\s*first-search/);
});

test('dsh-spotlight client module registers in shell.overlay, intercepts search, and loads previews', () => {
  const clientCode = readFileSync(join(__dirname, '..', 'client.js'), 'utf8');
  assert.match(clientCode, /dsh-spotlight/);
  assert.match(clientCode, /shell\.overlay/);
  assert.match(clientCode, /dsh:spotlight:open/);
  assert.match(clientCode, /dsh-spotlight-overlay/);
  assert.match(clientCode, /dsh-spotlight-preview-pane/);
  assert.match(clientCode, /dsh-spotlight-line-matched/);
  assert.match(clientCode, /dsh-spotlight-filter-btn/);
  assert.match(clientCode, /KeyK|key\.toLowerCase\(\) === 'k'/);
  assert.match(clientCode, /sessionMessagesCache/);
  assert.match(clientCode, /dsh-spotlight-open-btn/);
});

test('dsh-spotlight client module adapts for mobile viewports and touch interaction', () => {
  const clientCode = readFileSync(join(__dirname, '..', 'client.js'), 'utf8');
  assert.match(clientCode, /@media\s*\(max-width:\s*768px\)/);
  assert.match(clientCode, /dsh-spotlight-close-btn/);
  assert.match(clientCode, /Buscar/);
  assert.match(clientCode, /toggleSidebar/);
  assert.match(clientCode, /data-sidebar-collapsed/);
  assert.match(clientCode, /16px\s*!important/);
  assert.match(clientCode, /overlayLayer.*z-index:\s*1000/s);
});
