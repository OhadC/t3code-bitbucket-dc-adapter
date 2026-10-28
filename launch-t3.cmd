@echo off
set BITBUCKET_HTTPS=https://bitbucket.example.com/scm/
set BITBUCKET_SSH=ssh://git@bitbucket.example.com:7999/
set T3CODE_BITBUCKET_API_BASE_URL=http://127.0.0.1:8787/2.0
set GIT_CONFIG_COUNT=1
set GIT_CONFIG_KEY_0=url.%BITBUCKET_SSH%.insteadOf
set GIT_CONFIG_VALUE_0=%BITBUCKET_HTTPS%
for %%f in ("%LOCALAPPDATA%\Programs\t3code\T3 Code*.exe") do start "" "%%f"
