@echo off
setlocal
cd /d "%~dp0\..\.."

set "NODE_BIN=%USERPROFILE%\Axelate-deps\node\node.exe"
if exist "%NODE_BIN%" (
    "%NODE_BIN%" scripts\workflow.mjs dev:inspect %*
) else (
    node scripts\workflow.mjs dev:inspect %*
)

if errorlevel 1 pause
