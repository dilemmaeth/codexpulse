import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRIVATE_ROOT = join(PROJECT_ROOT, '.codexpulse', 'private');
const LOG_FILE = join(PRIVATE_ROOT, 'sync.log');
const NODE = process.execPath;

function run(script, args = []) {
  return spawnSync(NODE, [join(PROJECT_ROOT, 'scripts', script), ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

async function log(event) {
  await mkdir(PRIVATE_ROOT, { recursive: true });
  try {
    const current = await readFile(LOG_FILE, 'utf8');
    if (current.length > 200_000) await writeFile(LOG_FILE, current.slice(-100_000), 'utf8');
  } catch {
    // The log is created below on the first run.
  }
  await appendFile(LOG_FILE, `${new Date().toISOString()} ${JSON.stringify(event)}\n`, 'utf8');
}

async function main() {
  const sync = run('codexpulse-sync.mjs');
  if (sync.status !== 0) {
    await log({ status: 'sync-failed', detail: String(sync.stderr || '').trim().split(/\r?\n/u).at(-1) || 'unknown' });
    process.exitCode = 1;
    return;
  }
  const syncResult = JSON.parse(String(sync.stdout).trim());
  // Publishing tracks its own receipt, including a pending Pages dispatch.
  // An unchanged collector must not suppress retries after a network failure.
  const publish = run('codexpulse-publish.mjs');
  if (publish.status !== 0) {
    await log({ status: 'publish-failed', generatedAt: syncResult.generatedAt, detail: String(publish.stderr || '').trim().split(/\r?\n/u).at(-1) || 'unknown' });
    process.exitCode = 1;
    return;
  }
  const publishResult = JSON.parse(String(publish.stdout).trim());
  await log({ status: publishResult.status, generatedAt: syncResult.generatedAt });
}

main().catch(async (error) => {
  await log({ status: 'runner-failed', detail: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
