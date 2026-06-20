@echo off
reg add "HKCU\Software\Classes\zelux\shell\open\command" /ve /t REG_SZ /d "\"e:\ProjectCode\ZELUX-DL\dist\ZELUX-DL.exe\" \"%%1\"" /f
