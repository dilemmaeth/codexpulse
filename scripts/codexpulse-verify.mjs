import { createDecipheriv, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRIVATE_ROOT = join(PROJECT_ROOT, '.codexpulse', 'private');
const CONFIG_FILE = join(PRIVATE_ROOT, 'config.json');
const DATA_FILE = join(PRIVATE_ROOT, 'codexpulse-data.enc.json');
const RECOVERY_FILE = join(PRIVATE_ROOT, 'recovery-code.txt');
const USAGE_CACHE = join(PROJECT_ROOT, '.cache', 'usage-data.json');
const SNAPSHOT_AAD = Buffer.from('codexpulse:snapshot:v1');
const BASE32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const OUTER_KEYS = ['algorithm', 'data', 'generatedAt', 'iv', 'keyId', 'version'];
const FORBIDDEN_KEYS = new Set(['cwd', 'rolloutPath', 'rolloutPaths', 'firstUserMessage', 'preview', 'prompt', 'messages', 'raw']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function inspectKeys(value, trail = 'snapshot') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!FORBIDDEN_KEYS.has(key), `Tiltott nyers mező: ${trail}.${key}`);
    inspectKeys(child, `${trail}.${key}`);
  }
}

function decrypt(envelope, key) {
  const combined = Buffer.from(envelope.data, 'base64url');
  assert(combined.length > 16, 'A titkosított adat túl rövid.');
  const cipherText = combined.subarray(0, -16);
  const tag = combined.subarray(-16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
  decipher.setAAD(SNAPSHOT_AAD);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8'));
}

function decodeRecoveryCode(code) {
  const normalized = code.trim().toUpperCase().replace(/^CP1-/u, '').replaceAll('-', '').replaceAll(' ', '');
  assert(normalized.length === 58 && Array.from(normalized).every((character) => BASE32.includes(character)), 'A helyreállítási kód formátuma hibás.');
  let bits = 0;
  let value = 0;
  const decoded = [];
  for (const character of normalized) {
    value = (value << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      decoded.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  assert(decoded.length === 36 && (bits === 0 || (value & ((1 << bits) - 1)) === 0), 'A helyreállítási kód hossza hibás.');
  const raw = Buffer.from(decoded.slice(0, 32));
  const checksum = Buffer.from(decoded.slice(32));
  assert(checksum.equals(createHash('sha256').update(raw).digest().subarray(0, 4)), 'A helyreállítási kód ellenőrzőösszege hibás.');
  return raw;
}

async function main() {
  assert(existsSync(CONFIG_FILE), 'Hiányzik a helyi konfiguráció.');
  assert(existsSync(DATA_FILE), 'Hiányzik a titkosított adatsnapshot.');
  const [config, envelope] = await Promise.all([
    readFile(CONFIG_FILE, 'utf8').then(JSON.parse),
    readFile(DATA_FILE, 'utf8').then(JSON.parse),
  ]);
  const key = Buffer.from(config.masterKey || '', 'base64url');
  assert(key.length === 32, 'A mesterkulcs nem 256 bites.');
  assert(JSON.stringify(Object.keys(envelope).sort()) === JSON.stringify(OUTER_KEYS), 'Az envelope publikus mezőlistája megváltozott.');
  assert(envelope.version === 1 && envelope.algorithm === 'A256GCM', 'Ismeretlen envelope-verzió.');
  assert(envelope.keyId === createHash('sha256').update(key).digest().subarray(0, 9).toString('base64url'), 'A kulcsazonosító eltér.');

  const snapshot = decrypt(envelope, key);
  assert(snapshot.schemaVersion === 1 && snapshot.source === 'codexpulse-local', 'Ismeretlen snapshot-verzió.');
  assert(Array.isArray(snapshot.tasks) && snapshot.tasks.length > 0, 'Nem található feldolgozott gyökérfeladat.');
  assert(Array.isArray(snapshot.months) && snapshot.months.length > 0, 'Nem található havi összegzés.');
  for (const id of ['2026-07', '2026-08']) {
    const month = snapshot.months.find((item) => item.id === id);
    assert(month, `Hiányzik a ${id} havi becslés.`);
    assert(month.estimated === true, `${id} nincs becsültként jelölve.`);
  }
  inspectKeys(snapshot);
  for (const task of snapshot.tasks) {
    assert(!/[A-Za-z]:[\\/]/u.test(task.title), 'Egy feladatcím helyi elérési utat tartalmaz.');
    assert(!/\\\\\?\\/u.test(task.title), 'Egy feladatcím extended Windows-elérési utat tartalmaz.');
  }

  let incrementalDays = 0;
  if (config.eventUsage?.version === 2) {
    const ledger = config.eventUsage;
    const cacheTotal = ledger.baseCache.daily.reduce((sum, day) => sum + Number(day.totalTokens || 0), 0);
    const eventTotal = Object.values(ledger.days).reduce((sum, day) => sum + day.totalTokens, 0);
    const actual = snapshot.months.reduce((sum, month) => sum + month.usage.totalTokens, 0);
    assert(Math.abs(actual - cacheTotal - eventTotal) < 2, 'A rögzített alap és eseménynapló összege eltér.');
    for (const month of snapshot.months) {
      assert(Math.abs(month.usage.totalTokens - month.days.reduce((sum, day) => sum + day.totalTokens, 0)) < 2, 'A napi és havi összeg eltér.');
      assert(Math.abs(month.usage.totalTokens - month.models.reduce((sum, model) => sum + model.tokens, 0)) < 2, 'A modell- és havi összeg eltér.');
    }
    incrementalDays = Object.keys(ledger.days).length;
  }
  if (!config.eventUsage && existsSync(USAGE_CACHE) && config.incrementalUsage?.version === 1) {
    const usageCache = JSON.parse(await readFile(USAGE_CACHE, 'utf8'));
    const cacheTotal = usageCache.daily.reduce((sum, day) => sum + Number(day.totalTokens || 0), 0);
    const ledgerEntries = Object.values(config.incrementalUsage.days || {});
    const ledgerTotal = ledgerEntries.reduce((sum, day) => sum + Number(day.totalTokens || 0), 0);
    const snapshotTotal = snapshot.months.reduce((sum, month) => sum + Number(month.usage.totalTokens || 0), 0);
    const taskStateTotal = Object.values(config.incrementalUsage.taskTokens || {}).reduce((sum, tokens) => sum + Number(tokens || 0), 0);
    assert(Math.abs(snapshotTotal - cacheTotal - ledgerTotal) < 2, 'A növekményes főkönyv és a havi összeg eltér.');
    assert(Math.abs(taskStateTotal - Number(config.incrementalUsage.lastTaskTotal || 0)) < 2, 'A növekményes feladatállapot összege eltér.');
    incrementalDays = ledgerEntries.length;
  }

  const encryptedText = await readFile(DATA_FILE, 'utf8');
  assert(!encryptedText.includes('codexpulse-local'), 'A titkosított fájl olvasható snapshot-részletet tartalmaz.');
  if (existsSync(RECOVERY_FILE)) {
    const recoveryText = await readFile(RECOVERY_FILE, 'utf8');
    const code = recoveryText.split(/\r?\n/u).find((line) => line.startsWith('CP1-')) || '';
    const recovered = decodeRecoveryCode(code);
    assert(recovered.equals(key), 'A helyreállítási kód nem a jelenlegi kulcshoz tartozik.');
    recovered.fill(0);
  }
  key.fill(0);
  process.stdout.write(`${JSON.stringify({
    status: 'verified',
    months: snapshot.months.length,
    rootTasks: snapshot.tasks.length,
    estimatedHistory: ['2026-07', '2026-08'],
    incrementalDays,
    outerFields: OUTER_KEYS.length,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`CodexPulse verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
