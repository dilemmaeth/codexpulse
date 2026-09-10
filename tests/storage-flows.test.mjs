import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const importTS = async (path) => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'))).toString('base64')}`);
const cryptoTools = await importTS('../lib/codexpulse/crypto.ts');
const { validateVault } = await importTS('../lib/codexpulse/vault.ts');
const empty = { categoryOverrides: {}, outcomeOverrides: {}, projectRules: {}, reportIncludesProjects: false };
const keys = { protectedKey: 'key', snapshot: 'snapshot', localVault: 'vault', failedUnlocks: 'failed' };
const source = stripTypeScriptTypes(readFileSync(new URL('../hooks/use-codexpulse.ts', import.meta.url), 'utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm, '').replace(/^export /gm, '');

async function harness({ wrongNetwork = false } = {}) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const bundle = await cryptoTools.protectMasterKey('123456', raw, 'https://example.invalid/data');
  const key = await cryptoTools.importMasterKey(raw);
  const vault = { ...empty, categoryOverrides: { example: 'testing' }, outcomeOverrides: { example: 'success' } };
  const initialEncrypted = await cryptoTools.encryptLocalValue(vault, key);
  const cached = { version: 1, algorithm: 'A256GCM', keyId: bundle.keyId, data: 'valid' };
  const memory = new Map([[keys.protectedKey, bundle], [keys.localVault, initialEncrypted], [keys.snapshot, cached]]);
  let stateIndex = 0; let downloaded;
  const states = ['ready', 'hu', { version: 1, key: cryptoTools.bytesToBase64Url(raw), keyId: bundle.keyId, dataUrl: bundle.dataUrl }, bundle, key, { generatedAt: '2026-09-10T00:00:00Z' }, vault];
  const refs = [];
  const storage = { get: async name => memory.get(name), set: async (name, value) => memory.set(name, value), remove: async name => memory.delete(name), setMany: async entries => { for (const [name, value] of entries) memory.set(name, value); }, clear: async () => memory.clear() };
  const context = vm.createContext({ ...cryptoTools, validateVault, EMPTY_VAULT: empty, DEMO_SNAPSHOT: {},
    useState: initial => [stateIndex < states.length ? states[stateIndex++] : (stateIndex++, initial), () => {}],
    useRef: value => { const ref = { current: value }; refs.push(ref); return ref; }, useEffect: () => {}, useCallback: fn => fn, useMemo: fn => fn(),
    secureStorage: storage, storageKeys: keys, loadProtectedKey: async () => memory.get(keys.protectedKey), loadCachedEnvelope: async () => memory.get(keys.snapshot),
    preferredLanguage: () => 'hu', saveLanguage: () => {}, saveBackupFile: async value => { downloaded = value; },
    fetch: async () => ({ ok: true, json: async () => ({ ...cached, data: wrongNetwork ? 'tampered' : 'valid' }) }),
    decryptSnapshot: async envelope => { if (envelope.data !== 'valid') throw new Error('BAD_TAG'); return { generatedAt: '2026-09-10T00:00:00Z' }; },
    window: { location: { href: 'https://example.invalid/' } }, Date, File, Error, Promise,
  });
  vm.runInContext(source, context);
  const app = vm.runInContext('useCodexPulse()', context);
  // The vault ref starts empty before the real unlock path fills it.
  await app.unlock('123456');
  return { app, memory, raw, bundle, key, vault, initialEncrypted, getBackup: () => downloaded };
}

test('same-key PIN recovery preserves existing encrypted corrections', async () => {
  const h = await harness();
  await h.app.setupPin('654321');
  const restored = await cryptoTools.unlockMasterKey('654321', h.memory.get(keys.protectedKey));
  const vault = await cryptoTools.decryptLocalValue(h.memory.get(keys.localVault), restored.key);
  assert.equal(vault.categoryOverrides.example, 'testing');
  assert.equal(vault.outcomeOverrides.example, 'success');
  await assert.rejects(cryptoTools.unlockMasterKey('123456', h.memory.get(keys.protectedKey)));
  h.raw.fill(0); restored.raw.fill(0);
});

test('tampered network snapshot cannot replace last authenticated cache', async () => {
  const h = await harness({ wrongNetwork: true });
  await h.app.refresh();
  assert.equal(h.memory.get(keys.snapshot).data, 'valid');
  h.raw.fill(0);
});

test('rapid edits are serialized, encrypted backup restores, wrong key leaves vault intact', async () => {
  const h = await harness();
  for (let i = 0; i < 15; i++) h.app.updateVault(current => ({ ...current, projectRules: { ...current.projectRules, example: { name: `Project ${i}` } } }));
  await h.app.backupVault();
  const saved = await cryptoTools.decryptLocalValue(h.memory.get(keys.localVault), h.key);
  assert.equal(saved.projectRules.example.name, 'Project 14');
  const backup = h.getBackup();
  assert.equal(backup.includes('Project 14'), false);
  h.app.updateVault(current => ({ ...current, projectRules: {} }));
  await h.app.restoreVault(new File([backup], 'backup.json'));
  const restored = await cryptoTools.decryptLocalValue(h.memory.get(keys.localVault), h.key);
  assert.equal(restored.projectRules.example.name, 'Project 14');
  const before = h.memory.get(keys.localVault);
  const wrong = JSON.parse(backup); wrong.keyId = 'wrong';
  await assert.rejects(h.app.restoreVault(new File([JSON.stringify(wrong)], 'wrong.json')));
  assert.equal(h.memory.get(keys.localVault), before);
  h.raw.fill(0);
});

test('corrupt existing vault blocks re-pairing without overwriting key or corrections', async () => {
  const h = await harness();
  h.memory.set(keys.localVault, 'broken');
  const bundle = h.memory.get(keys.protectedKey);
  await assert.rejects(h.app.setupPin('654321'));
  assert.equal(h.memory.get(keys.localVault), 'broken');
  assert.equal(h.memory.get(keys.protectedKey), bundle);
  h.raw.fill(0);
});
