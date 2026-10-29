@echo off
chcp 65001 >nul
title ZeluxDL Extension 1-Click Installer
echo ============================================================
echo   ZeluxDL Browser Extension 1-Click Installer
echo   กำลังเริ่มติดตั้งส่วนขยายเบราว์เซอร์อัตโนมัติ...
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-extension.ps1"
echo.
pause
