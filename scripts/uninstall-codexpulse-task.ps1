$ErrorActionPreference = 'Stop'
$taskName = 'CodexPulse Sync'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Eltávolítva: $taskName"
} else {
  Write-Output "Nincs telepített CodexPulse ütemezés."
}
