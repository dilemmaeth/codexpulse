import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withLock } from './codexpulse-lock.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRIVATE_ROOT = join(PROJECT_ROOT, '.codexpulse', 'private');
const CONFIG_FILE = join(PRIVATE_ROOT, 'config.json');
const DATA_FILE = join(PRIVATE_ROOT, 'codexpulse-data.enc.json');
const PUBLISH_ROOT = join(PROJECT_ROOT, '.codexpulse', 'publish');
const PUBLISHED_DATA = join(PUBLISH_ROOT, 'codexpulse-data.enc.json');
const WORKFLOW_FILE = join(PROJECT_ROOT, '.github', 'workflows', 'pages.yml');
const PUBLISHED_WORKFLOW = join(PUBLISH_ROOT, '.github', 'workflows', 'pages.yml');
const RECEIPT_FILE = join(PRIVATE_ROOT, 'publish-receipt.json');

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: PUBLISH_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (!allowFailure && result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/u).at(-1);
    throw new Error(`git ${args[0]} sikertelen${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

async function dispatchPages(repository) {
  const startedAt = Date.now() - 5_000;
  const result = spawnSync('gh', ['workflow', 'run', 'pages.yml', '--repo', repository, '--ref', 'main'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/u).at(-1);
    throw new Error(`A GitHub Pages indítása sikertelen${detail ? `: ${detail}` : ''}`);
  }
  for (let attempt = 0; attempt < 48; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const listed = spawnSync('gh', ['run', 'list', '--repo', repository, '--workflow', 'pages.yml', '--branch', 'main', '--event', 'workflow_dispatch', '--limit', '10', '--json', 'databaseId,status,conclusion,createdAt'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    if (listed.status !== 0) continue;
    const run = JSON.parse(listed.stdout).filter((item) => Date.parse(item.createdAt) >= startedAt).sort((a, b) => b.databaseId - a.databaseId)[0];
    if (run?.status !== 'completed') continue;
    if (run.conclusion !== 'success') throw new Error(`Pages deployment ${run.conclusion}; next sync will retry`);
    return;
  }
  throw new Error('Pages deployment confirmation timed out; next sync will retry');
}

function validateRepositoryUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('A repositoryUrl nem érvényes URL.'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u.test(url.pathname)) {
    throw new Error('A repositoryUrl HTTPS-alapú github.com repository legyen.');
  }
  url.hash = '';
  url.search = '';
  return { url: url.href, repository: url.pathname.replace(/^\//u, '').replace(/\.git$/u, '') };
}

async function main() {
  if (!existsSync(CONFIG_FILE) || !existsSync(DATA_FILE)) throw new Error('Hiányzik a CodexPulse konfiguráció vagy a titkosított snapshot.');
  const config = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  const { url: repositoryUrl, repository } = validateRepositoryUrl(config.repositoryUrl || '');
  const digest = createHash('sha256').update(await readFile(DATA_FILE)).update(await readFile(WORKFLOW_FILE)).update(repository).digest('hex');
  let receipt = null;
  try { receipt = JSON.parse(await readFile(RECEIPT_FILE, 'utf8')); } catch { /* First publication. */ }
  if (receipt?.digest === digest) {
    process.stdout.write(`${JSON.stringify({ status: 'unchanged' })}\n`);
    return;
  }
  await mkdir(PUBLISH_ROOT, { recursive: true });

  if (!existsSync(join(PUBLISH_ROOT, '.git'))) {
    git(['init', '-b', 'data']);
    git(['remote', 'add', 'origin', repositoryUrl]);
  } else {
    const current = git(['remote', 'get-url', 'origin'], { allowFailure: true });
    if (current.status !== 0) git(['remote', 'add', 'origin', repositoryUrl]);
    else if (String(current.stdout).trim() !== repositoryUrl.replace(/\/$/u, '')) git(['remote', 'set-url', 'origin', repositoryUrl]);
  }

  const fetched = git(['fetch', '--quiet', 'origin', 'data'], { allowFailure: true }).status === 0;
  if (fetched) git(['checkout', '--quiet', '-B', 'data', 'origin/data']);
  else git(['checkout', '--quiet', '-B', 'data'], { allowFailure: true });

  await mkdir(join(PUBLISH_ROOT, '.github', 'workflows'), { recursive: true });
  await copyFile(DATA_FILE, PUBLISHED_DATA);
  await copyFile(WORKFLOW_FILE, PUBLISHED_WORKFLOW);
  git(['add', '--', 'codexpulse-data.enc.json', '.github/workflows/pages.yml']);
  const changed = git(['diff', '--cached', '--quiet'], { allowFailure: true }).status !== 0;
  if (changed) git(['commit', '--quiet', '-m', 'Update encrypted usage snapshot']);
  git(['push', '--quiet', 'origin', 'HEAD:data']);
  await dispatchPages(repository);
  await writeFile(`${RECEIPT_FILE}.tmp`, JSON.stringify({ digest, dispatchedAt: new Date().toISOString() }), { mode: 0o600 });
  await rename(`${RECEIPT_FILE}.tmp`, RECEIPT_FILE);
  process.stdout.write(`${JSON.stringify({ status: 'published', branch: 'data' })}\n`);
}

withLock(join(PRIVATE_ROOT, 'publish.lock'), main).catch((error) => {
  process.stderr.write(`CodexPulse publish failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
