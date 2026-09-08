import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import QRCode from 'qrcode';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRIVATE_ROOT = join(PROJECT_ROOT, '.codexpulse', 'private');
const CONFIG_FILE = join(PRIVATE_ROOT, 'config.json');
const PAIR_FILE = join(PRIVATE_ROOT, 'pair.html');
const RECOVERY_FILE = join(PRIVATE_ROOT, 'recovery-code.txt');
const BASE32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value.startsWith('--')) result[value.slice(2).replaceAll('-', '_')] = values[++index];
  }
  return result;
}

function html(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function recoveryCodeFor(rawKey) {
  const checksum = createHash('sha256').update(rawKey).digest().subarray(0, 4);
  const input = Buffer.concat([rawKey, checksum]);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return `CP1-${output.match(/.{1,5}/gu)?.join('-') || output}`;
}

const args = parseArgs(process.argv.slice(2));

async function main() {
  if (!existsSync(CONFIG_FILE)) throw new Error('Előbb futtasd: npm run codexpulse:sync -- --initialize');
  const config = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  const rawKey = Buffer.from(config.masterKey || '', 'base64url');
  if (rawKey.length !== 32) throw new Error('A helyi titkosítási kulcs hibás.');

  const appUrl = new URL(args.app_url || config.appUrl);
  if (!['https:', 'http:'].includes(appUrl.protocol)) throw new Error('Az app URL-címének HTTP(S) címnek kell lennie.');
  appUrl.hash = '';
  const dataUrl = new URL(args.data_url || config.dataUrl, appUrl).href;
  const keyId = createHash('sha256').update(rawKey).digest().subarray(0, 9).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    appUrl: appUrl.href,
    dataUrl,
    key: rawKey.toString('base64url'),
    keyId,
  })).toString('base64url');
  const pairingUrl = `${appUrl.href}#pair=${payload}`;
  const qr = await QRCode.toString(pairingUrl, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
    color: { dark: '#07121AFF', light: '#FFFFFFFF' },
  });
  const recoveryCode = recoveryCodeFor(rawKey);

  config.appUrl = appUrl.href;
  config.dataUrl = args.data_url || config.dataUrl;
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await writeFile(RECOVERY_FILE, [
    'CodexPulse v1 — helyreállítási kód / recovery code',
    '',
    recoveryCode,
    '',
    'Tartsd titokban. A kód hozzáférést ad a titkosított statisztikáidhoz.',
    'Keep it private. This code unlocks your encrypted statistics.',
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o600 });
  await writeFile(PAIR_FILE, `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CodexPulse párosítás</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#050d13;color:#edf8fa}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0,#12333b 0,transparent 42%)}main{width:min(100%,520px);padding:28px;border:1px solid #17333d;border-radius:24px;background:#08151dcc;box-shadow:0 32px 100px #0008;text-align:center}h1{margin:0 0 8px;font-size:28px}p{color:#8aa1aa;line-height:1.55}.qr{width:min(100%,340px);margin:24px auto;padding:14px;border-radius:18px;background:#fff}.qr svg{display:block;width:100%;height:auto}ol{display:grid;gap:9px;padding-left:24px;color:#b3c7cc;text-align:left}a{display:inline-flex;margin-top:12px;padding:12px 18px;border-radius:12px;color:#061216;background:#59ddd7;font-weight:700;text-decoration:none}.note{font-size:12px;color:#647b84}.brand{color:#65e1dc;font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
</style></head><body><main><div class="brand">CodexPulse v1</div><h1>iPhone párosítása</h1><p>Olvasd be a QR-kódot az iPhone kamerájával. A titkos kulcs csak a hivatkozás <em>fragment</em> részében utazik, ezért a webkiszolgáló nem kapja meg.</p><div class="qr">${qr}</div><ol><li>Nyisd meg a felismert hivatkozást.</li><li>Állíts be egy 6 számjegyű PIN-kódot.</li><li>Mentsd el a megjelenő helyreállítási kódot.</li><li>Safari: Megosztás → Hozzáadás a Főképernyőhöz.</li></ol><a href="${html(pairingUrl)}">Párosító hivatkozás megnyitása</a><p class="note">App: ${html(appUrl.href)}<br>Ne küldd el ezt a fájlt vagy a QR-kódot másnak.</p></main></body></html>`, { encoding: 'utf8', mode: 0o600 });

  rawKey.fill(0);
  process.stdout.write(`${JSON.stringify({ status: 'ready', pairingFile: PAIR_FILE, recoveryFile: RECOVERY_FILE })}\n`);
}

main().catch((error) => {
  process.stderr.write(`CodexPulse pairing failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
