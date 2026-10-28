param([Parameter(Mandatory)][string]$Upstream)
$main = Join-Path $PSScriptRoot main.ts
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like "*$main*"
if ($running) { exit }
$log = Join-Path $env:TEMP t3code-bitbucket-dc-adapter
Start-Process node -WindowStyle Hidden -ArgumentList "`"$main`" --upstream $Upstream" -RedirectStandardOutput "$log.log" -RedirectStandardError "$log.err.log"
