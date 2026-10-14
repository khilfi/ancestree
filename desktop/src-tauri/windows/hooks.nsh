; AncesTree's additions to Tauri's Windows installer.

; The engine's folder replaced whole (0.8.1, D76): Tauri's installer writes each file of the
; new version over the old, and leaves every file the new one no longer has, so updates since
; 0.4.0 left each version's files beside the next. Taken away first, the folder then holds the
; new version's alone. Only a folder that's the engine's goes. An engine still running keeps
; its files; it tidies the rest at its start.
!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "$INSTDIR\engine\ancestree-engine.exe"
    RMDir /r "$INSTDIR\engine"
  ${EndIf}
!macroend

; Start at sign-in keeps a second value beside its Run entry, where Windows notes whether the
; entry is switched on. Tauri's uninstaller takes the Run entry away; this takes the other
; with it, unless the app is only being updated. Uninstalled, the engine's folder goes whole,
; with whatever earlier versions left in it (0.8.1).
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
    ${If} ${FileExists} "$INSTDIR\engine\*.*"
      RMDir /r "$INSTDIR\engine"
    ${EndIf}
  ${EndIf}
!macroend
