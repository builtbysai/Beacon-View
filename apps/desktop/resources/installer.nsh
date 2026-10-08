; Beacon NSIS additions (ADR 0083), included by electron-builder.

!macro customInstall
  ; Register beaconsecureview:// for this user so Google sign-in and camera
  ; setup links open Beacon even before its first launch.
  WriteRegStr SHCTX "Software\Classes\beaconsecureview" "" "URL:Beacon"
  WriteRegStr SHCTX "Software\Classes\beaconsecureview" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\beaconsecureview\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\beaconsecureview\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; One-click camera setup: a pre-configured download carries a short-lived
  ; pairing code in its file name. Record the installer's own name; the app
  ; reads it once on first launch, finishes setup, and deletes it. An
  ; ordinary installer's name contains no code and is simply discarded.
  CreateDirectory "$APPDATA\Beacon"
  FileOpen $0 "$APPDATA\Beacon\pending-camera-setup.txt" w
  FileWrite $0 "$EXEFILE"
  FileClose $0
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller before installing the new version
  ; (ADR 0085); keep the link handler so nothing breaks mid-update. User data
  ; (sessions, camera credentials) is never deleted either way.
  ${ifNot} ${isUpdated}
    DeleteRegKey SHCTX "Software\Classes\beaconsecureview"
  ${endIf}
!macroend
