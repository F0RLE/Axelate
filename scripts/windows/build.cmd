@echo off
setlocal
cd /d "%~dp0\..\.."

set "NODE_BIN=%USERPROFILE%\Axelate-deps\node\node.exe"
if exist "%NODE_BIN%" (
    "%NODE_BIN%" .github\scripts\workflow.mjs build %*
) else (
    node .github\scripts\workflow.mjs build %*
)

if errorlevel 1 pause
