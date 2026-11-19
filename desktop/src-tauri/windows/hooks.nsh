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

; Removing AncesTree, with the backups safe. The two macros below are inserted by
; AncesTree's own copy of Tauri's template (windows/installer.nsi), at its two places marked
; "AncesTree's", after the template's own variables are declared.
;
; The uninstaller's first page, in place of Tauri's confirm page: its families' box in plain
; words, with But keep the backups under it, and, on the keeper's computer, what keeping the
; family again needs. What it knows of the families comes from the note AncesTree keeps for it
; in its folder, uninstall.ini (ancestree/desktop/removing.py), in UTF-16 as Windows reads such
; a note: each family's name, the folder its backups are in and the one they go to in
; Documents, whether this computer keeps it, when its backups were last copied to another
; place, and the warning's sentences. Started by AncesTree's Remove AncesTree from this
; computer..., the uninstaller is given /DELETEFAMILIES, and the families' box is ticked as it
; opens; silent (/S), /DELETEFAMILIES ticks both boxes. During an update (/UPDATE), or passive
; (/P), the page never shows, and the families stay, as before.
!macro ANCESTREE_UNINSTALL_PAGE
  !define ANCESTREE_NOTE "$LOCALAPPDATA\${BUNDLEID}\uninstall.ini"
  Var DeleteAppDataCheckbox ; the families' box, under Tauri's name for its own
  Var DeleteAppDataCheckboxState ; ticked or not: Tauri's uninstall section reads it
  Var KeepBackupsCheckbox
  Var KeepBackupsState
  UninstPage custom un.AncesTreeFamilies un.AncesTreeFamiliesLeave

  Function un.AncesTreeFamilies
    ${If} $PassiveMode = 1
    ${OrIf} $UpdateMode = 1
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Uninstall ${PRODUCTNAME}" "Remove ${PRODUCTNAME} from this computer."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 26u "${PRODUCTNAME} goes from this computer: the app, its icon by the clock and its Start menu entry. Copies of backups kept in another place, such as on a USB stick or in OneDrive, are never touched."
    Pop $0
    ; On the keeper's computer, the warning, and the boxes below it.
    Call un.AncesTreeKeeperWarning
    Pop $1
    StrCpy $2 30
    ${If} $1 != ""
      ${NSD_CreateLabel} 0 30u 100% 56u $1
      Pop $0
      SetCtlColors $0 9A3412 transparent
      StrCpy $2 90
    ${EndIf}
    ${NSD_CreateCheckbox} 0 $2u 100% 20u "Also delete the families from this computer:$\r$\ntheir people, photos, life stories, settings and backups."
    Pop $DeleteAppDataCheckbox
    IntOp $3 $2 + 22
    ${NSD_CreateCheckbox} 12u $3u -12u 20u "But keep the backups: move them to Documents\AncesTree backups."
    Pop $KeepBackupsCheckbox
    ${NSD_Check} $KeepBackupsCheckbox
    ClearErrors
    ${GetOptions} $CMDLINE "/DELETEFAMILIES" $0
    ${IfNot} ${Errors}
      ${NSD_Check} $DeleteAppDataCheckbox
    ${Else}
      EnableWindow $KeepBackupsCheckbox 0
    ${EndIf}
    ${NSD_OnClick} $DeleteAppDataCheckbox un.AncesTreeFamiliesBox
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(^UninstallBtn)"
    nsDialogs::Show
  FunctionEnd

  ; But keep the backups means something only while the families' box is ticked.
  Function un.AncesTreeFamiliesBox
    Pop $0
    ${NSD_GetState} $DeleteAppDataCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      EnableWindow $KeepBackupsCheckbox 1
    ${Else}
      EnableWindow $KeepBackupsCheckbox 0
    ${EndIf}
  FunctionEnd

  Function un.AncesTreeFamiliesLeave
    ${NSD_GetState} $DeleteAppDataCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $DeleteAppDataCheckboxState 1
    ${Else}
      StrCpy $DeleteAppDataCheckboxState 0
    ${EndIf}
    ${NSD_GetState} $KeepBackupsCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $KeepBackupsState 1
    ${Else}
      StrCpy $KeepBackupsState 0
    ${EndIf}
  FunctionEnd

  ; The keeper's warning, on the stack: AncesTree's sentences for the families this computer
  ; keeps; for each, if none of its backups was copied to another place in the last 7 days
  ; (604800 seconds), that too; then what it suggests first. Empty where this computer keeps
  ; no family, or AncesTree left no note.
  Function un.AncesTreeKeeperWarning
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    ReadINIStr $R0 "${ANCESTREE_NOTE}" "AncesTree" "warning"
    ${If} $R0 != ""
      ; Now, in seconds since 1970, as the note's times are.
      System::Call "kernel32::GetSystemTimeAsFileTime(*l .R1)"
      System::Int64Op $R1 / 10000000
      Pop $R1
      System::Int64Op $R1 - 11644473600
      Pop $R1
      ReadINIStr $R2 "${ANCESTREE_NOTE}" "AncesTree" "families"
      ${For} $R3 1 $R2
        ReadINIStr $R4 "${ANCESTREE_NOTE}" "family$R3" "keeper"
        ${If} $R4 == "1"
          ReadINIStr $R4 "${ANCESTREE_NOTE}" "family$R3" "copied"
          System::Int64Op $R1 - $R4
          Pop $R4
          System::Int64Op $R4 > 604800
          Pop $R4
          ${If} $R4 == "1"
            ReadINIStr $R4 "${ANCESTREE_NOTE}" "family$R3" "stale"
            StrCpy $R0 "$R0 $R4"
          ${EndIf}
        ${EndIf}
      ${Next}
      ReadINIStr $R4 "${ANCESTREE_NOTE}" "AncesTree" "first"
      StrCpy $R0 "$R0$\r$\n$R4"
    ${EndIf}
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
  FunctionEnd

  ; Each family's backups to Documents\AncesTree backups\<its name>, before the families go:
  ; the whole folder moved, at once, on the same disk; else each backup copied. If any can't be
  ; kept, or there's no note to say where they are, nothing of the families goes, and that's
  ; said: never a backup deleted that the page said would be kept.
  Function un.AncesTreeKeepBackups
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    StrCpy $R4 0 ; how many families' backups couldn't be kept
    ${IfNot} ${FileExists} "${ANCESTREE_NOTE}"
      StrCpy $R4 1
    ${EndIf}
    ReadINIStr $R0 "${ANCESTREE_NOTE}" "AncesTree" "families"
    ${For} $R1 1 $R0
      ReadINIStr $R2 "${ANCESTREE_NOTE}" "family$R1" "backups"
      ReadINIStr $R3 "${ANCESTREE_NOTE}" "family$R1" "folder"
      ${If} $R2 == ""
      ${OrIf} $R3 == ""
        ${Continue}
      ${EndIf}
      StrCpy $R2 "$LOCALAPPDATA\${BUNDLEID}\$R2"
      StrCpy $R3 "$DOCUMENTS\AncesTree backups\$R3"
      ${IfNot} ${FileExists} "$R2\ancestree-backup-*.zip"
        ${Continue}
      ${EndIf}
      CreateDirectory "$DOCUMENTS\AncesTree backups"
      ${IfNot} ${FileExists} "$R3\*.*"
        ClearErrors
        Rename "$R2" "$R3"
      ${EndIf}
      ${If} ${FileExists} "$R2\ancestree-backup-*.zip"
        ClearErrors
        CreateDirectory "$R3"
        CopyFiles /SILENT "$R2\ancestree-backup-*.zip" "$R3"
        ${If} ${Errors}
          IntOp $R4 $R4 + 1
        ${EndIf}
      ${EndIf}
      DetailPrint "Backups kept in $R3"
    ${Next}
    ${If} $R4 <> 0
      StrCpy $DeleteAppDataCheckboxState 0
      MessageBox MB_ICONEXCLAMATION|MB_OK "${PRODUCTNAME} couldn't keep every family's backups in Documents\AncesTree backups, so the families stay on this computer, as they are, in $LOCALAPPDATA\${BUNDLEID}." /SD IDOK
    ${EndIf}
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  FunctionEnd
!macroend

; In the uninstall section, before Tauri's own deleting of the families: silent, with
; /DELETEFAMILIES, both boxes ticked; then the backups kept, if the families go and But keep
; the backups is ticked. Never during an update.
!macro ANCESTREE_KEEP_BACKUPS
  ${If} ${Silent}
    ClearErrors
    ${GetOptions} $CMDLINE "/DELETEFAMILIES" $0
    ${IfNot} ${Errors}
      StrCpy $DeleteAppDataCheckboxState 1
      StrCpy $KeepBackupsState 1
    ${EndIf}
  ${EndIf}
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
  ${AndIf} $KeepBackupsState = 1
    Call un.AncesTreeKeepBackups
  ${EndIf}
!macroend
