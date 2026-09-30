; AncesTree's additions to Tauri's Windows installer.

; Start at sign-in keeps a second value beside its Run entry, where Windows notes whether the
; entry is switched on. Tauri's uninstaller takes the Run entry away; this takes the other
; with it, unless the app is only being updated.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
  ${EndIf}
!macroend
