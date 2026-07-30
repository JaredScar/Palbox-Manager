; installer.nsh — Custom NSIS logic injected by electron-builder
;
; Node.js version bundled as a fallback if winget is unavailable.
; Update this when a newer Node.js 22 LTS is released.
!define NODE_LTS_VERSION "22.23.2"
!define NODE_MSI_URL "https://nodejs.org/dist/v${NODE_LTS_VERSION}/node-v${NODE_LTS_VERSION}-x64.msi"

!macro customInstall
  ; ── Node.js check & auto-install ─────────────────────────────────────────
  nsExec::ExecToStack 'cmd /c node --version 2>&1'
  Pop $0   ; exit code (0 = node found)
  Pop $1   ; output   (e.g. "v22.23.2")

  ${If} $0 != 0
    ; Node.js not found — ask the user
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Node.js was not detected on this machine.$\n$\n\
Palbox requires Node.js 22 LTS to run its API server.$\n$\n\
Click Yes to install Node.js ${NODE_LTS_VERSION} LTS now (~35 MB).$\n\
Click No to install it manually later (https://nodejs.org)." \
      IDYES lbl_node_install IDNO lbl_node_skip

    lbl_node_install:
      ; ── Strategy 1: winget (Windows 10 1809+ / Windows 11) ────────────────
      DetailPrint "Trying winget to install Node.js 22 LTS..."
      nsExec::ExecToLog \
        'winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements'
      Pop $R0

      ${If} $R0 != 0
        ; ── Strategy 2: Download MSI directly from nodejs.org ─────────────
        DetailPrint "winget unavailable or failed — downloading Node.js MSI..."

        ; PowerShell downloads to %TEMP%\palbox-node-lts.msi
        nsExec::ExecToLog \
          'powershell -NoProfile -ExecutionPolicy Bypass -Command \
            "Invoke-WebRequest -Uri ${NODE_MSI_URL} \
                               -OutFile \"$env:TEMP\palbox-node-lts.msi\" \
                               -UseBasicParsing"'

        DetailPrint "Installing Node.js ${NODE_LTS_VERSION} LTS..."

        ; Run msiexec using the NSIS $TEMP variable (same as %TEMP%)
        nsExec::ExecToLog `msiexec /i "$TEMP\palbox-node-lts.msi" /qn /norestart ADDLOCAL=ALL`

        ; Clean up
        nsExec::Exec `cmd /c del /f /q "$TEMP\palbox-node-lts.msi"`
      ${EndIf}

      DetailPrint "Node.js installation complete."

    lbl_node_skip:
  ${EndIf}

  ; Create the per-user config directory (where .env is stored)
  CreateDirectory "$APPDATA\Palbox"
!macroend

!macro customUnInstall
  ; Stop and remove the Palbox API service if NSSM is available
  nsExec::ExecToStack 'cmd /c where nssm 2>&1'
  Pop $0
  Pop $1
  ${If} $0 == 0
    nsExec::Exec 'nssm stop PalboxAPI'
    nsExec::Exec 'nssm remove PalboxAPI confirm'
  ${EndIf}
!macroend
