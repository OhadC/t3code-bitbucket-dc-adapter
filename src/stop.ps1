$main = Join-Path $PSScriptRoot main.ts
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -like "*$main*" | ForEach-Object { Stop-Process -Id $_.ProcessId }
