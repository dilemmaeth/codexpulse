import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';

test('Pages failure is retried even after successful push; receipt skips only confirmed success', async () => {
  const source = readFileSync(new URL('../scripts/codexpulse-publish.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function validateRepositoryUrl'), source.indexOf('withLock(join'));
  const memory = new Map(); let dispatches = 0, pushes = 0;
  const context = vm.createContext({ URL, createHash, join, Date,
    CONFIG_FILE: 'config', DATA_FILE: 'data', WORKFLOW_FILE: 'workflow', RECEIPT_FILE: 'receipt', PUBLISH_ROOT: 'checkout', PUBLISHED_DATA: 'published-data', PUBLISHED_WORKFLOW: 'published-workflow',
    existsSync: () => true, mkdir: async () => {}, copyFile: async () => {},
    readFile: async name => { if (name === 'config') return JSON.stringify({ repositoryUrl: 'https://github.com/example/test' }); if (name === 'receipt') { if (!memory.has(name)) throw new Error('missing'); return memory.get(name); } return Buffer.from(name); },
    writeFile: async (name, value) => memory.set(name, value), rename: async (from, to) => memory.set(to, memory.get(from)),
    git: args => { if (args[0] === 'push') pushes++; return { status: 0, stdout: 'https://github.com/example/test' }; },
    dispatchPages: async () => { if (++dispatches === 1) throw new Error('simulated Pages failure'); },
    process: { stdout: { write: () => {} } },
  });
  vm.runInContext(body, context);
  await assert.rejects(vm.runInContext('main()', context));
  assert.equal(memory.has('receipt'), false);
  await vm.runInContext('main()', context);
  assert.equal(dispatches, 2);
  assert.equal(pushes, 2);
  await vm.runInContext('main()', context);
  assert.equal(dispatches, 2);
  assert.equal(pushes, 2);
});
