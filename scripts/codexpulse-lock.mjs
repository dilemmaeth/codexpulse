import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export async function withLock(path, action) {
  mkdirSync(dirname(path), { recursive: true });
  let handle;
  try { handle = openSync(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(readFileSync(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Incomplete collector lock; retry later');
    let running = true;
    try { process.kill(pid, 0); } catch (reason) { if (reason.code === 'ESRCH') running = false; }
    if (running) throw new Error('Another CodexPulse operation is already running');
    // Only this app-owned lock for a confirmed exited process is removed.
    unlinkSync(path);
    handle = openSync(path, 'wx', 0o600);
  }
  try {
    writeFileSync(handle, String(process.pid));
    return await action();
  } finally {
    closeSync(handle);
    unlinkSync(path);
  }
}
