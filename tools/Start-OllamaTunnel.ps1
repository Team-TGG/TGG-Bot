param(
  [Parameter(Mandatory = $true)][string]$IdentityFile,
  [ValidatePattern('^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$')][string]$SshTarget = 'ubuntu@147.15.3.187',
  [ValidateRange(1024,65535)][int]$RemotePort = 11435,
  [ValidateRange(1024,65535)][int]$LocalPort = 11434
)
$ErrorActionPreference = 'Stop'
# Um processo iniciado pelo PowerShell 7 pode herdar seu PSModulePath no Windows PowerShell 5.
# Carregar o módulo do próprio host evita importar o Security de uma versão incompatível.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$stateDir = Join-Path $env:LOCALAPPDATA 'TGG-Bot'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$logFile = Join-Path $stateDir 'ollama-tunnel.log'
$stateFile = Join-Path $stateDir 'ollama-tunnel-state.json'
function Write-TunnelLog([string]$Message) {
  if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 1048576) {
    [IO.File]::WriteAllText($logFile, '')
  }
  Add-Content -LiteralPath $logFile -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Message)
}
$mutex = [Threading.Mutex]::new($false, ('Local\TGG-Ollama-Tunnel-' + $RemotePort))
$ownsMutex = $false
$sshProcess = $null
$keyDir = $null
try {
  try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) { exit 0 }
  $sourceKey = (Resolve-Path -LiteralPath $IdentityFile).Path
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $keyDir = Join-Path ([IO.Path]::GetTempPath()) ('tgg-ollama-ssh-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $keyDir | Out-Null
  $dirAcl = [Security.AccessControl.DirectorySecurity]::new()
  $dirAcl.SetAccessRuleProtection($true, $false)
  $dirAcl.SetOwner($identity)
  $dirAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  Set-Acl -LiteralPath $keyDir -AclObject $dirAcl
  $keyPath = Join-Path $keyDir 'access.key'
  Copy-Item -LiteralPath $sourceKey -Destination $keyPath
  $keyAcl = [Security.AccessControl.FileSecurity]::new()
  $keyAcl.SetAccessRuleProtection($true, $false)
  $keyAcl.SetOwner($identity)
  $keyAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow'))
  Set-Acl -LiteralPath $keyPath -AclObject $keyAcl
  Write-TunnelLog ('Iniciando conexao com ' + $SshTarget + ', porta privada ' + $RemotePort)

  while ($true) {
    try {
      try { Invoke-RestMethod -Uri ('http://127.0.0.1:' + $LocalPort + '/api/version') -TimeoutSec 3 | Out-Null }
      catch {
        $ollamaPath = (Get-Command ollama -ErrorAction SilentlyContinue).Source
        if (-not $ollamaPath) { $ollamaPath = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe' }
        if (Test-Path -LiteralPath $ollamaPath) {
          $env:OLLAMA_HOST = '127.0.0.1:' + $LocalPort
          Start-Process -FilePath $ollamaPath -ArgumentList 'serve' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'ollama-out.log') -RedirectStandardError (Join-Path $stateDir 'ollama-error.log') | Out-Null
        }
      }
      $sshArgs = @('-N','-T','-i',('"' + $keyPath + '"'),'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-R',('127.0.0.1:' + $RemotePort + ':127.0.0.1:' + $LocalPort),$SshTarget)
      $sshErrorLog = Join-Path $stateDir 'ollama-ssh-error.log'
      $sshProcess = Start-Process -FilePath (Get-Command ssh -ErrorAction Stop).Source -ArgumentList $sshArgs -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'ollama-ssh-out.log') -RedirectStandardError $sshErrorLog -PassThru
      [IO.File]::WriteAllText($stateFile, (@{ workerPid=$PID; sshPid=$sshProcess.Id; remotePort=$RemotePort; localPort=$LocalPort; target=$SshTarget } | ConvertTo-Json))
      $sshProcess.WaitForExit()
      Write-TunnelLog ('SSH encerrou; nova tentativa em 5s. ' + ((Get-Content -LiteralPath $sshErrorLog -Tail 2 -ErrorAction SilentlyContinue) -join ' '))
    } catch { Write-TunnelLog ('Falha de conexao: ' + $_.Exception.Message) }
    Start-Sleep -Seconds 5
  }
} finally {
  if ($sshProcess -and -not $sshProcess.HasExited) { $sshProcess.Kill() }
  if ($keyDir) {
    $keyPath = Join-Path $keyDir 'access.key'
    if (Test-Path -LiteralPath $keyPath) { Remove-Item -LiteralPath $keyPath }
    if (Test-Path -LiteralPath $keyDir) { Remove-Item -LiteralPath $keyDir }
  }
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
