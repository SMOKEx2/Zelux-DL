@echo off
reg add HKCU\Software\Classes\zelux\shell\open\command /ve /d "\"cmd.exe\" /c \"e:\ProjectCode\ZELUX-DL\dist\ZELUX-DL.exe\" \"%%1\" > \"e:\ProjectCode\ZELUX-DL\debug_crash.log\" 2>&1" /f
