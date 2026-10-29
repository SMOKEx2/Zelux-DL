; Prism NSIS installer hooks (included by Tauri's NSIS template).
; Registers the browser native messaging host and the magnet: link handler for the
; current user, and removes them again on uninstall.

; The browser keeps the native messaging host running while the extension is connected, which
; locks prism-native-host.exe. Stop it before files are replaced or removed; the extension
; reconnects on its own afterwards.
!macro PRISM_STOP_HOST
  DetailPrint "Stopping the browser helper..."
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM zeluxdl-native-host.exe'
  Sleep 300
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro PRISM_STOP_HOST
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering browser integration..."
  nsExec::ExecToLog '"$INSTDIR\zeluxdl-native-host.exe" register'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing browser integration..."
  nsExec::ExecToLog '"$INSTDIR\zeluxdl-native-host.exe" unregister'
  !insertmacro PRISM_STOP_HOST
!macroend
