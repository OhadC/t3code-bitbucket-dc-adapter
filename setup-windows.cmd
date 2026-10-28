@echo off
node -e "if (process.versions.node.split('.')[0] < 24) process.exit(1)" 2>nul || (echo Node.js 24 or newer is required: https://nodejs.org & pause & exit /b 1)
node "%~dp0src\setup.ts"
pause
