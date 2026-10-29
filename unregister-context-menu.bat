@echo off
chcp 65001 >nul
title ZeluxDL - Remove Windows Context Menu
echo ============================================================
echo   ZeluxDL Windows Context Menu Remover
echo   กำลังถอนเมนูคลิกขวาออกจาก Windows Explorer...
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\unregister-context-menu.ps1"
echo.
pause
