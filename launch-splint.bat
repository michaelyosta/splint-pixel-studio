@echo off
setlocal
cd /d "%~dp0"

set "SHELL=powershell.exe"
where pwsh.exe >nul 2>nul
if %errorlevel% equ 0 set "SHELL=pwsh.exe"

%SHELL% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-splint.ps1" %*
endlocal
