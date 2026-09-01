@echo off
setlocal
set "ZELUX_PATH=%~dp0dist\ZELUX-DL.exe"
if not exist "%ZELUX_PATH%" (
  echo ZELUX-DL.exe not found at "%ZELUX_PATH%"
  exit /b 1
)
reg add "HKCU\Software\Classes\zelux" /ve /t REG_SZ /d "URL:ZELUX-DL Protocol" /f
reg add "HKCU\Software\Classes\zelux" /v "URL Protocol" /t REG_SZ /d "" /f
reg add "HKCU\Software\Classes\zelux\shell\open\command" /ve /t REG_SZ /d "\"%ZELUX_PATH%\" \"%%1\"" /f
echo Registered zelux:// to "%ZELUX_PATH%"
