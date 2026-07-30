@echo off
if exist "%PLUGIN_ROOT%\bin\windows\petlink-hook.exe" (
  "%PLUGIN_ROOT%\bin\windows\petlink-hook.exe"
  exit /b %errorlevel%
)
node "%PLUGIN_ROOT%\scripts\petlink-hook.mjs"
