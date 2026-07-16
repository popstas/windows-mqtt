; Wipe the app payload dir before the installer copies the new files, so every
; install behaves like a clean install.
;
; Why: NSIS only overwrites paths that exist in the NEW bundle. Anything dropped
; from the bundle survives upgrades forever and can silently win at runtime:
;   - `_up_\config.yml` (was a resource once, now gone) shadowed the real config
;     in %APPDATA% whenever the user removed theirs, hiding the example-config
;     fallback behind a years-stale file.
;   - `_up_\node_modules\segfault-handler` lingered after the package was
;     removed from package.json.
;
; Safe to wipe: `_up_` is read-only app payload. User data (config.yml,
; commands.yml, logs, reports, sysstats) lives in %APPDATA%\windows-mqtt.
; The one runtime-written path in here is `_up_\data\windows11-manager.log`,
; a regenerable log.
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Removing previous app payload for a clean install..."
  RMDir /r "$INSTDIR\_up_"
!macroend
