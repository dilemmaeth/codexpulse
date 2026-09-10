# CodexPulse

CodexPulse is a private, installable iPhone dashboard for reviewing local Codex usage, focus and outcomes. The interface is available in Hungarian and English.

## What v1 includes

- Monthly token totals, active days, tasks and personal usage/results indices
- Project, category, daily activity, model and outcome breakdowns
- Five editable categories: Development, Research, Planning, Testing and Documentation
- Local task category/outcome corrections and project rename/hide/merge rules
- Sanitized monthly PNG/PDF reports with project names hidden by default
- July and August 2026 estimates kept as separate months
- Installable offline PWA with a safe update prompt
- QR pairing, a 6-digit PIN and a checksum-protected recovery code
- Recovery from the locked screen without discarding same-key corrections
- Encrypted correction backups (save to Files and restore on a paired device)

## Privacy model

The Windows collector reads local Codex SQLite indexes and a frozen ccusage baseline. On first migration it reads rollout tails back to that baseline timestamp; later runs read only appended complete lines. It keeps token counters, dates and models, never raw conversation text. Rate-limit indicators use bounded tails from up to eight recent files. Subagents roll into their root task. Raw prompts, messages, rollout logs, paths and keys never enter the public artifact.

The snapshot is encrypted locally with AES-256-GCM before it can leave the PC. GitHub receives only ciphertext and minimal envelope metadata. The data key is transferred in the URL fragment of the private pairing QR; URL fragments are not sent to the web server. The QR is reusable and must remain secret. On the iPhone, the data key is wrapped with a key derived from the PIN using PBKDF2-HMAC-SHA256 (600,000 iterations), then stored in IndexedDB. Decrypted data exists only in memory while the app is unlocked.

Keep the generated QR and recovery code private. A public GitHub repository is required for free GitHub Pages hosting, so the source code and encrypted snapshot are publicly downloadable even though the snapshot content is not readable without the key.

The six-digit PIN and in-app retry delays are a convenient device lock, not a substitute for a high-entropy password against an attacker who can extract and brute-force the complete browser storage. The public snapshot itself is protected by the independent random 256-bit data key.

## Data quality

- Token totals combine an immutable timestamped ccusage baseline with subsequent token events. Updating the external cache cannot add those events again. Replayed/fork-inherited events are deduplicated.
- Daily event dates use Europe/Budapest, including month boundaries. The migration boundary and incomplete source history remain limitations, not independently verified billing records.
- July and August remain separate estimates. Initial per-task month allocations are estimates frozen at migration; new observed tokens are appended to their event month. Task/project/category estimates use the same unscaled basis, separate from monthly log totals.
- Results index uses success = 1, partial = 0.5, failed/open = 0, compared with matching elapsed periods in previous months. Automatic outcomes are heuristics; corrections record the selected month.
- New event token fields come from the logs. Their API cost uses the frozen baseline's average cost per token, not current model-specific pricing. Days containing this estimate are marked estimated.
- Activity duration is a recorded Codex activity period, not a claim about human work hours.
- The displayed USD amount is an API-price equivalent estimate, not a ChatGPT invoice or credit balance.
- Quotas are timestamped observations, not live account limits. Expired windows are not displayed as current percentages.

## Recovery and correction backups

The CP1 recovery code restores the data key, not a copy of device-local corrections. Same-key PIN recovery preserves existing corrections; corrupt or different-key data blocks replacement rather than silently resetting it. Export an encrypted correction backup from Settings and save it outside browser storage. To restore on a new device, first pair with the same key/recovery code, then import the backup. Import explicitly replaces the current corrections after confirmation. No key or PIN is included in that backup.

Writes are serialized and resolve after IndexedDB transaction completion. Downloaded snapshots are authenticated before replacing the last valid offline copy. Browser/site-data deletion can still remove local data, so a saved backup is necessary for disaster recovery.

## Regression checks

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm audit`, and `npm run build:pages`. The Pages workflow runs tests and scoped lint before deployment. The service worker precaches the generated JS/CSS asset manifest and deletes only older CodexPulse caches.

The publisher records success only after a successful Pages run. Failed uploads or deployments are retried on the next scheduled run even if collection is unchanged. Unchanged successful publications need no network call.

## Local verification

PowerShell can run npm through Node directly even when `npm.ps1` is blocked:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run typecheck
& 'C:\Program Files\nodejs\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run build:pages
& 'C:\Program Files\nodejs\node.exe' scripts\codexpulse-sync.mjs --force
& 'C:\Program Files\nodejs\node.exe' scripts\codexpulse-verify.mjs
```

The static deployment artifact is written to `dist/codexpulse`.

## GitHub Pages and automatic sync

The included workflow builds the app from `main`, adds the encrypted snapshot from the separate `data` branch, and deploys the combined artifact to GitHub Pages. Publishing is intentionally a separate, explicit setup step.

After the repository and Pages URL exist, the one-time Windows setup is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-codexpulse-task.ps1 `
  -RepositoryUrl 'https://github.com/OWNER/REPOSITORY.git' `
  -AppUrl 'https://OWNER.github.io/REPOSITORY/' `
  -IntervalHours 6
```

This creates `CodexPulse Sync` in Windows Task Scheduler. It has no permanently running background service: it starts after sign-in and at six-hour intervals, waits for three minutes of idle time, checks lightweight database/cache fingerprints, and exits immediately if nothing changed. If data changed, it commits the encrypted snapshot and the deployment workflow needed to trigger Pages to the `data` branch.

Double-click `Open CodexPulse Pairing.vbs` to regenerate and open the local pairing page without a visible terminal window. On iPhone, scan the QR, choose a PIN, save the recovery code, then use Safari → Share → Add to Home Screen.

To remove only the scheduled task:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-codexpulse-task.ps1
```

Private keys, pairing files, logs, cached usage data and the isolated publishing checkout stay under ignored `.codexpulse/` and `.cache/` folders.
