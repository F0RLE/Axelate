@echo off
setlocal
cd /d "%~dp0\..\.."

set "NODE_BIN=%USERPROFILE%\Axelate-deps\node\node.exe"
if exist "%NODE_BIN%" (
    "%NODE_BIN%" scripts\workflow.mjs test %*
) else (
    node scripts\workflow.mjs test %*
)

if errorlevel 1 pause
