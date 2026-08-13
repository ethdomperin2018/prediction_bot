$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $ProjectRoot 'run-bot.js'))) {
  # Allow calling from project root as .\scripts\run-daily.ps1
  if (Test-Path (Join-Path (Get-Location) 'run-bot.js')) {
    $ProjectRoot = (Get-Location).Path
  }
}

Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$LogFile = Join-Path $LogDir "bot_$Stamp.log"

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path $LogFile -Value $line
  Write-Host $line
}

Write-Log "Starting MLB prediction bot in $ProjectRoot"
Write-Log "Log file: $LogFile"

try {
  & node run-bot.js 2>&1 | ForEach-Object {
    $text = "$_"
    Add-Content -Path $LogFile -Value $text
    Write-Host $text
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Bot exited with code $LASTEXITCODE"
  }
  Write-Log "Bot finished successfully"
  exit 0
} catch {
  Write-Log "Bot failed: $_"
  exit 1
}
