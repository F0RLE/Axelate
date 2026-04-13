@echo off
setlocal
cd /d "%~dp0\..\.."

set "NODE_BIN=%USERPROFILE%\Axelate-deps\node\node.exe"
if exist "%NODE_BIN%" (
    "%NODE_BIN%" scripts\workflow.mjs verify %*
) else (
    node scripts\workflow.mjs verify %*
)

if errorlevel 1 pause
