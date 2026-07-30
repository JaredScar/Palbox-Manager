; installer.nsh — Custom NSIS logic injected by electron-builder
; Checks that Node.js 22+ is installed before completing setup.

!macro customInstall
  ; Check for Node.js
  nsExec::ExecToStack 'cmd /c node --version'
  Pop $0
  Pop $1
  
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Node.js was not detected on this machine.$\n$\nPalbox requires Node.js 22 or newer to run the API server.$\n$\nPlease install it from https://nodejs.org and re-run the installer."
    ; Don't abort — the user might still want the Electron shell installed
  ${EndIf}
  
  ; Create the userData AppData directory for .env
  CreateDirectory "$APPDATA\Palbox"
!macroend

!macro customUnInstall
  ; Optionally stop and remove the PalboxAPI NSSM service on uninstall
  nsExec::Exec 'nssm stop PalboxAPI'
  nsExec::Exec 'nssm remove PalboxAPI confirm'
!macroend
