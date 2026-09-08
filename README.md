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

## Privacy model

The Windows collector reads the local Codex SQLite indexes and the small ccusage cache. For current rate-limit indicators it reads only bounded tails from up to eight recent rollout files; it never performs a periodic full-log scan. It rolls subagents into their root task and never publishes raw prompts, chat messages, rollout logs or local paths.

The snapshot is encrypted locally with AES-256-GCM before it can leave the PC. GitHub receives only ciphertext and minimal envelope metadata. The data key is transferred in the URL fragment of the one-time pairing QR; URL fragments are not sent to the web server. On the iPhone, the data key is wrapped with a key derived from the PIN using PBKDF2-HMAC-SHA256 (600,000 iterations), then stored in IndexedDB. Decrypted data exists only in memory while the app is unlocked.

Keep the generated QR and recovery code private. A public GitHub repository is required for free GitHub Pages hosting, so the source code and encrypted snapshot are publicly downloadable even though the snapshot content is not readable without the key.

The six-digit PIN and in-app retry delays are a convenient device lock, not a substitute for a high-entropy password against an attacker who can extract and brute-force the complete browser storage. The public snapshot itself is protected by the independent random 256-bit data key.

## Data quality

- Token totals use the local ccusage cache where available.
- July and August 2026 task allocation is estimated from recorded turns and activity.
- A small amount of activity newer than the ccusage cache can appear as an estimated current-month delta.
- Activity duration is a recorded Codex activity period, not a claim about human work hours.
- The displayed USD amount is an API-price equivalent estimate, not a ChatGPT invoice or credit balance.

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
