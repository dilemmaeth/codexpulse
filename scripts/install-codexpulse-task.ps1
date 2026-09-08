param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?$')]
  [string]$RepositoryUrl,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://')]
  [string]$AppUrl,

  [ValidateRange(3, 6)]
  [int]$IntervalHours = 6
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$syncScript = Join-Path $PSScriptRoot 'codexpulse-sync.mjs'
$pairScript = Join-Path $PSScriptRoot 'codexpulse-pair.mjs'
$publishScript = Join-Path $PSScriptRoot 'codexpulse-publish.mjs'
$runScript = Join-Path $PSScriptRoot 'codexpulse-run.mjs'
$taskName = 'CodexPulse Sync'

& $nodePath $syncScript --initialize --force --app-url $AppUrl --data-url './codexpulse-data.enc.json' --repository-url $RepositoryUrl
if ($LASTEXITCODE -ne 0) { throw 'A kezdeti CodexPulse szinkron sikertelen.' }
& $nodePath $pairScript --app-url $AppUrl --data-url './codexpulse-data.enc.json'
if ($LASTEXITCODE -ne 0) { throw 'A CodexPulse párosító létrehozása sikertelen.' }
& $nodePath $publishScript
if ($LASTEXITCODE -ne 0) { throw 'A kezdeti CodexPulse publikálás sikertelen.' }

$action = New-ScheduledTaskAction -Execute $nodePath -Argument ('"{0}"' -f $runScript) -WorkingDirectory $projectRoot
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '00:00'
$dailyTrigger.Repetition.Interval = "PT${IntervalHours}H"
$dailyTrigger.Repetition.Duration = 'P1D'
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RunOnlyIfIdle `
  -IdleDuration (New-TimeSpan -Minutes 3) `
  -IdleWaitTimeout (New-TimeSpan -Hours 1) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $dailyTrigger) -Settings $settings -Principal $principal -Description 'CodexPulse: titkosított Codex-statisztika frissítése bejelentkezéskor és üresjáratban.' -Force | Out-Null
Write-Output "CodexPulse ütemezés elkészült: $taskName"
Write-Output "Párosító: $(Join-Path $projectRoot '.codexpulse\private\pair.html')"
