@echo off
chcp 65001 >nul
title ZeluxDL - Add Windows Context Menu
echo ============================================================
echo   ZeluxDL Windows Context Menu Integrator
echo   กำลังเพิ่มเมนูคลิกขวาใน Windows Explorer...
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\register-context-menu.ps1"
echo.
pause
