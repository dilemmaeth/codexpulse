import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRIVATE_ROOT = join(PROJECT_ROOT, '.codexpulse', 'private');
const CONFIG_FILE = join(PRIVATE_ROOT, 'config.json');
const DATA_FILE = join(PRIVATE_ROOT, 'codexpulse-data.enc.json');
const PUBLISH_ROOT = join(PROJECT_ROOT, '.codexpulse', 'publish');
const PUBLISHED_DATA = join(PUBLISH_ROOT, 'codexpulse-data.enc.json');
const WORKFLOW_FILE = join(PROJECT_ROOT, '.github', 'workflows', 'pages.yml');
const PUBLISHED_WORKFLOW = join(PUBLISH_ROOT, '.github', 'workflows', 'pages.yml');

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

function dispatchPages(repository) {
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
  if (!changed) {
    process.stdout.write(`${JSON.stringify({ status: 'unchanged' })}\n`);
    return;
  }
  git(['commit', '--quiet', '-m', 'Update encrypted usage snapshot']);
  git(['push', '--quiet', 'origin', 'HEAD:data']);
  dispatchPages(repository);
  process.stdout.write(`${JSON.stringify({ status: 'published', branch: 'data' })}\n`);
}

main().catch((error) => {
  process.stderr.write(`CodexPulse publish failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
