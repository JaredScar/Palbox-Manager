; installer.nsh — Custom NSIS logic injected by electron-builder
;
; Node.js fallback version used when winget is unavailable.
; Update NODE_LTS_VERSION when a newer Node.js 22 LTS ships.
!define NODE_LTS_VERSION "22.23.2"
!define NODE_MSI_URL "https://nodejs.org/dist/v${NODE_LTS_VERSION}/node-v${NODE_LTS_VERSION}-x64.msi"

!macro customInstall
  ; ── Check whether Node.js 22+ is already installed ────────────────────────
  nsExec::ExecToStack 'cmd /c node --version 2>&1'
  Pop $0   ; exit code
  Pop $1   ; output (e.g. "v22.23.2")

  ${If} $0 != 0
    MessageBox MB_YESNO|MB_ICONQUESTION "Node.js was not detected on this machine.$\n$\nPalbox requires Node.js 22 LTS to run its API server.$\n$\nInstall Node.js ${NODE_LTS_VERSION} LTS now? (~35 MB download)" IDYES lbl_node_install IDNO lbl_node_skip

    lbl_node_install:
      ; ── Strategy 1: winget (Windows 10 1809+ / Windows 11) ────────────────
      DetailPrint "Attempting Node.js install via winget..."
      nsExec::ExecToLog 'winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements'
      Pop $R0

      ${If} $R0 != 0
        ; ── Strategy 2: Download MSI from nodejs.org ──────────────────────
        ; Store the destination path in $R1 using NSIS $TEMP (avoids $env:TEMP
        ; which NSIS misparses as an unknown variable and treats as an error).
        StrCpy $R1 "$TEMP\palbox-node-lts.msi"

        DetailPrint "winget unavailable — downloading Node.js ${NODE_LTS_VERSION} LTS MSI..."
        nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '${NODE_MSI_URL}' -OutFile '$R1' -UseBasicParsing"`

        DetailPrint "Installing Node.js ${NODE_LTS_VERSION} LTS silently..."
        nsExec::ExecToLog `msiexec /i "$R1" /qn /norestart ADDLOCAL=ALL`

        Delete $R1
      ${EndIf}

      DetailPrint "Node.js installation complete."

    lbl_node_skip:
  ${EndIf}

  ; Ensure the per-user config directory exists for .env
  CreateDirectory "$APPDATA\Palbox"
!macroend

!macro customUnInstall
  ; Stop and remove the Palbox API Windows service if NSSM is available
  nsExec::ExecToStack 'cmd /c where nssm 2>&1'
  Pop $0
  Pop $1
  ${If} $0 == 0
    nsExec::Exec 'nssm stop PalboxAPI'
    nsExec::Exec 'nssm remove PalboxAPI confirm'
  ${EndIf}
!macroend
