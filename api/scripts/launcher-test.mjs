// Verifies that the detached launcher actually runs a script, rather than
// merely producing a process id. Reproduces the update path's requirements:
// the script must run, and must report whether it holds Administrator.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { launchDetachedPowerShell } from '../dist/lib/detachedLauncher.js';

if (os.platform() !== 'win32') {
  console.log('SKIP: Windows only');
  process.exit(0);
}

const dir = path.join(os.tmpdir(), 'palbox-launcher-test');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const marker = path.join(dir, 'started.marker');
const result = path.join(dir, 'result.json');
const script = path.join(dir, 'probe.ps1');

const psLines = [
  `$markerFile = '${marker.replace(/'/g, "''")}'`,
  `$resultFile = '${result.replace(/'/g, "''")}'`,
  `try { [System.IO.File]::WriteAllText($markerFile, [System.DateTime]::UtcNow.ToString('o'), [System.Text.Encoding]::UTF8) } catch {}`,
  `$isAdmin = $false`,
  `try {`,
  `  $id = [Security.Principal.WindowsIdentity]::GetCurrent()`,
  `  $isAdmin = (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`,
  `} catch {}`,
  `$o = New-Object psobject -Property @{ user = [Environment]::UserName; isAdmin = $isAdmin; ps = $PSVersionTable.PSVersion.ToString() }`,
  `[System.IO.File]::WriteAllText($resultFile, ($o | ConvertTo-Json -Compress), [System.Text.Encoding]::UTF8)`,
];
fs.writeFileSync(script, '\uFEFF' + psLines.join('\r\n') + '\r\n', 'utf8');

const launch = await launchDetachedPowerShell(script, {
  taskName: 'PalboxLauncherTest',
  marker,
  outputLog: path.join(dir, 'output.log'),
});

console.log(`launched: ${launch.ok}   winner: ${launch.strategy ?? '(none)'}`);
for (const a of launch.attempts) {
  console.log(`  ${a.strategy.padEnd(15)} ${a.ok ? 'OK    ' : 'FAILED'}  ${a.detail}`);
}

// The marker only proves it started; the result proves it ran to completion.
let payload = null;
for (let i = 0; i < 20 && !payload; i++) {
  await new Promise((r) => setTimeout(r, 500));
  // .NET writes a BOM, which JSON.parse rejects.
  try { payload = JSON.parse(fs.readFileSync(result, 'utf8').replace(/^\uFEFF/, '')); } catch { /* not yet */ }
}
console.log('script output:', payload ?? 'NEVER RAN');

try { execFileSync('schtasks', ['/Delete', '/TN', 'PalboxLauncherTest', '/F'], { stdio: 'ignore' }); } catch { /* not created */ }

const output = fs.existsSync(path.join(dir, 'output.log'))
  ? fs.readFileSync(path.join(dir, 'output.log'), 'utf8').trim() : '';
if (output) console.log('captured output:', output);

if (!launch.ok || !payload) {
  console.error('FAIL: the launcher did not get the script running');
  process.exit(1);
}
console.log('PASS: the script ran and was verified via its marker');
