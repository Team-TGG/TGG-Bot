$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\CimCmdlets\CimCmdlets.psd1') -ErrorAction Stop
$stateDir = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'TGG-Bot'))
$workerPath = Join-Path $stateDir 'Start-OllamaTunnel.ps1'
$statePath = Join-Path $stateDir 'ollama-tunnel-state.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Output 'IA local ja esta desativada para o bot.'; exit 0 }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$worker = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$state.workerPid)
if ($worker -and $worker.CommandLine -like ('*' + $workerPath + '*')) {
  $sshProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$state.sshPid)
  $keyDir = $null
  $ownsSsh = $sshProcess -and $sshProcess.ParentProcessId -eq $worker.ProcessId -and $sshProcess.Name -eq 'ssh.exe' -and $sshProcess.CommandLine -like '*127.0.0.1:11435:127.0.0.1:11434*'
  if ($ownsSsh) {
    $match = [regex]::Match($sshProcess.CommandLine, '-i\s+"?([^"\r\n]*?access\.key)"?\s+-o')
    if ($match.Success) { $keyDir = Split-Path -Parent $match.Groups[1].Value }
  }
  Stop-Process -Id $worker.ProcessId -Force
  if ($ownsSsh) { Stop-Process -Id $sshProcess.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($keyDir) {
    $resolved = [IO.Path]::GetFullPath($keyDir)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -match '^tgg-ollama-ssh-[a-f0-9]{32}$') {
      $keyPath = Join-Path $resolved 'access.key'
      if (Test-Path -LiteralPath $keyPath) { Remove-Item -LiteralPath $keyPath }
      if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved }
    }
  }
}
Remove-Item -LiteralPath $statePath
Write-Output 'IA local desativada para o bot. O Ollama do PC continua disponivel para outros usos.'
