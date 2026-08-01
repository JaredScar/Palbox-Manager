/**
 * Extracts the apply-update.ps1 template from appVersion.ts, renders it with
 * representative values, and hands it to the PowerShell parser.
 *
 * The update script only ever runs detached on a user's VPS, where a syntax
 * error shows up as a silent no-op. Parsing it here turns that into a build
 * time failure instead.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src', 'routes', 'appVersion.ts'), 'utf8');

const start = source.indexOf('const ps = `');
const end = source.indexOf('\n`;', start);
if (start === -1 || end === -1) {
  console.error('Could not locate the PowerShell template in appVersion.ts');
  process.exit(1);
}
const template = source.slice(start + 'const ps = `'.length, end);

const esc = (s) => s.replace(/'/g, "''");
const render = new Function('esc', 'installDir', 'palboxService', 'zipPath',
  'extractDir', 'logFile', 'transcriptFile',
  'return `' + template + '`;');

const rendered = render(
  esc,
  'C:\\Palbox',
  'PalboxAPI',
  'C:\\PalboxUpdate\\palbox-server-0.7.9.zip',
  'C:\\PalboxUpdate\\extracted',
  'C:\\PalboxUpdate\\update.log',
  'C:\\PalboxUpdate\\transcript.log',
);

const out = path.join(os.tmpdir(), 'palbox-apply-update-check.ps1');
fs.writeFileSync(out, '\uFEFF' + rendered, 'utf8');

// Non-ASCII characters are what broke earlier releases: PowerShell 5.1 reads
// the file using the system codepage and a stray em dash derails the parser.
const nonAscii = [...rendered].filter((c) => c.charCodeAt(0) > 126);
if (nonAscii.length) {
  console.error(`FAIL: ${nonAscii.length} non-ASCII character(s): ${[...new Set(nonAscii)].join(' ')}`);
  process.exit(1);
}
console.log('OK: script is pure ASCII');

const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
  $errors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile('${out.replace(/'/g, "''")}', [ref]$null, [ref]$errors)
  if ($errors -and $errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Output ("PARSE ERROR line {0}: {1}" -f $_.Extent.StartLineNumber, $_.Message) }
    exit 1
  }
  Write-Output 'OK: PowerShell parsed the script with no errors'
`], { encoding: 'utf8' });

if (ps.error) {
  console.log(`SKIP: PowerShell unavailable (${ps.error.message})`);
  process.exit(0);
}
console.log((ps.stdout || '').trim());
if (ps.stderr?.trim()) console.error(ps.stderr.trim());
process.exit(ps.status ?? 0);
