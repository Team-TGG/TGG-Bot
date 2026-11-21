param(
  [Parameter(Mandatory = $true)][string]$IdentityFile,
  [ValidatePattern('^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$')][string]$SshTarget = 'ubuntu@147.15.3.187',
  [switch]$AutoStart,
  [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
$keyFile = (Resolve-Path -LiteralPath $IdentityFile).Path
$installDir = Join-Path $env:LOCALAPPDATA 'TGG-Bot'
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$workerPath = Join-Path $installDir 'Start-OllamaTunnel.ps1'
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($installDir)) {
  foreach ($name in @('Start-OllamaTunnel.ps1','Stop-OllamaTunnel.ps1','Install-OllamaTunnel.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $installDir $name) -Force
  }
}
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $workerPath + '" -IdentityFile "' + $keyFile + '" -SshTarget "' + $SshTarget + '"'
$shell = New-Object -ComObject WScript.Shell
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'TGG Ollama.lnk'
if ($AutoStart) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $installDir
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Conexao privada entre o bot TGG e o Ollama deste PC'
  $shortcut.Save()
} elseif (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath
}
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$startLink = $shell.CreateShortcut((Join-Path $desktop 'Ativar IA TGG.lnk'))
$startLink.TargetPath = $powershell
$startLink.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $installDir 'Install-OllamaTunnel.ps1') + '" -IdentityFile "' + $keyFile + '" -SshTarget "' + $SshTarget + '" -StartNow'
$startLink.WorkingDirectory = $installDir
$startLink.WindowStyle = 7
$startLink.Description = 'Ativa o Qwen local para o comando .ia do bot TGG'
$startLink.Save()
$stopLink = $shell.CreateShortcut((Join-Path $desktop 'Desativar IA TGG.lnk'))
$stopLink.TargetPath = $powershell
$stopLink.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $installDir 'Stop-OllamaTunnel.ps1') + '"'
$stopLink.WorkingDirectory = $installDir
$stopLink.WindowStyle = 7
$stopLink.Description = 'Encerra somente a conexao da IA local com o bot TGG'
$stopLink.Save()
if ($StartNow) { Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden | Out-Null }
Write-Output ('IA instalada em modo manual. Atalhos: ' + $desktop)
Write-Output ('Estado e logs: ' + $installDir)
if ($AutoStart) { Write-Output ('Inicializacao no login do Windows: ' + $shortcutPath) }
