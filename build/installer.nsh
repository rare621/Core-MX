; Uninstalling CoreMX also removes what it put in the game folder: its game plugin
; (plugins\mxbm_presence.dlo and plugins\mxbm_data\main.fnt) and the steam_appid.txt it wrote for
; Join and Host. The app keeps the exact paths in uninstall-cleanup.txt in its settings folder.
; Updates also run the old uninstaller; ${isUpdated} keeps everything in place then.
; Only these file names are ever deleted, whatever the list says.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ClearErrors
    FileOpen $0 "$APPDATA\MX Bikes Manager\uninstall-cleanup.txt" r
    ${ifNot} ${Errors}
      coremx_cleanup_loop:
        ClearErrors
        FileRead $0 $1
        ${if} ${Errors}
          Goto coremx_cleanup_done
        ${endif}
        ; Strip the line ending.
        coremx_trim:
          StrCpy $2 $1 1 -1
          ${if} $2 == "$\n"
          ${orIf} $2 == "$\r"
            StrCpy $1 $1 -1
            Goto coremx_trim
          ${endif}
        StrCpy $2 $1 26 -26
        ${if} $2 == "\plugins\mxbm_presence.dlo"
          Delete "$1"
        ${endif}
        StrCpy $2 $1 27 -27
        ${if} $2 == "\plugins\mxbm_data\main.fnt"
          Delete "$1"
          StrCpy $3 $1 -9
          RMDir "$3"
        ${endif}
        StrCpy $2 $1 16 -16
        ${if} $2 == "\steam_appid.txt"
          Delete "$1"
        ${endif}
        Goto coremx_cleanup_loop
      coremx_cleanup_done:
      FileClose $0
    ${endif}
  ${endif}
!macroend

; Previous builds packed the old reader inside app.asar. The updater replaces
; that archive. Remove only exact loose legacy paths if an older installation
; left them behind; never touch MX Bikes mods or user data.
!macro customInstall
  Delete "$INSTDIR\resources\app\src\lib\assetread.js"
  Delete "$INSTDIR\resources\app\scripts\read-asset.js"
!macroend
