import fs from 'fs';
import type { Instance } from '../db/types';

export interface PalSettings {
  Difficulty: string;
  DayTimeSpeedRate: string;
  NightTimeSpeedRate: string;
  ExpRate: string;
  PalCaptureRate: string;
  PalSpawnNumRate: string;
  PalDamageRateAttack: string;
  PalDamageRateDefense: string;
  PlayerDamageRateAttack: string;
  PlayerDamageRateDefense: string;
  PlayerStomachDecreaceRate: string;
  PlayerStaminaDecreaceRate: string;
  PlayerAutoHPRegeneRate: string;
  PlayerAutoHpRegeneRateInSleep: string;
  PalStomachDecreaceRate: string;
  PalStaminaDecreaceRate: string;
  PalAutoHPRegeneRate: string;
  PalAutoHpRegeneRateInSleep: string;
  BuildObjectDamageRate: string;
  BuildObjectDeteriorationDamageRate: string;
  CollectionDropRate: string;
  CollectionObjectHpRate: string;
  CollectionObjectRespawnSpeedRate: string;
  EnemyDropItemRate: string;
  DeathPenalty: string;
  bEnablePlayerToPlayerDamage: string;
  bEnableFriendlyFire: string;
  bEnableInvaderEnemy: string;
  bActiveUNKO: string;
  bEnableAimAssistPad: string;
  bEnableAimAssistKeyboard: string;
  DropItemMaxNum: string;
  DropItemMaxNum_UNKO: string;
  BaseCampMaxNum: string;
  BaseCampWorkerMaxNum: string;
  DropItemAliveMaxHours: string;
  bAutoResetGuildNoOnlinePlayers: string;
  AutoResetGuildTimeNoOnlinePlayers: string;
  GuildPlayerMaxNum: string;
  PalEggDefaultHatchingTime: string;
  WorkSpeedRate: string;
  bIsMultiplay: string;
  bIsPvP: string;
  bCanPickupOtherGuildDeathPenaltyDrop: string;
  bEnableNonLoginPenalty: string;
  bEnableFastTravel: string;
  bIsStartLocationSelectByMap: string;
  bExistPlayerAfterLogout: string;
  bEnableDefenseOtherGuildPlayer: string;
  CoopPlayerMaxNum: string;
  ServerPlayerMaxNum: string;
  ServerName: string;
  ServerDescription: string;
  AdminPassword: string;
  ServerPassword: string;
  PublicPort: string;
  PublicIP: string;
  RCONEnabled: string;
  RCONPort: string;
  Region: string;
  bUseAuth: string;
  BanListURL: string;
  [key: string]: string;
}

const DEFAULT_SETTINGS: PalSettings = {
  Difficulty: 'None',
  DayTimeSpeedRate: '1.000000',
  NightTimeSpeedRate: '1.000000',
  ExpRate: '1.000000',
  PalCaptureRate: '1.000000',
  PalSpawnNumRate: '1.000000',
  PalDamageRateAttack: '1.000000',
  PalDamageRateDefense: '1.000000',
  PlayerDamageRateAttack: '1.000000',
  PlayerDamageRateDefense: '1.000000',
  PlayerStomachDecreaceRate: '1.000000',
  PlayerStaminaDecreaceRate: '1.000000',
  PlayerAutoHPRegeneRate: '1.000000',
  PlayerAutoHpRegeneRateInSleep: '1.000000',
  PalStomachDecreaceRate: '1.000000',
  PalStaminaDecreaceRate: '1.000000',
  PalAutoHPRegeneRate: '1.000000',
  PalAutoHpRegeneRateInSleep: '1.000000',
  BuildObjectDamageRate: '1.000000',
  BuildObjectDeteriorationDamageRate: '1.000000',
  CollectionDropRate: '1.000000',
  CollectionObjectHpRate: '1.000000',
  CollectionObjectRespawnSpeedRate: '1.000000',
  EnemyDropItemRate: '1.000000',
  DeathPenalty: 'None',
  bEnablePlayerToPlayerDamage: 'False',
  bEnableFriendlyFire: 'False',
  bEnableInvaderEnemy: 'True',
  bActiveUNKO: 'False',
  bEnableAimAssistPad: 'True',
  bEnableAimAssistKeyboard: 'False',
  DropItemMaxNum: '3000',
  DropItemMaxNum_UNKO: '100',
  BaseCampMaxNum: '128',
  BaseCampWorkerMaxNum: '15',
  DropItemAliveMaxHours: '1.000000',
  bAutoResetGuildNoOnlinePlayers: 'False',
  AutoResetGuildTimeNoOnlinePlayers: '72.000000',
  GuildPlayerMaxNum: '20',
  PalEggDefaultHatchingTime: '72.000000',
  WorkSpeedRate: '1.000000',
  bIsMultiplay: 'False',
  bIsPvP: 'False',
  bCanPickupOtherGuildDeathPenaltyDrop: 'False',
  bEnableNonLoginPenalty: 'True',
  bEnableFastTravel: 'True',
  bIsStartLocationSelectByMap: 'True',
  bExistPlayerAfterLogout: 'False',
  bEnableDefenseOtherGuildPlayer: 'False',
  CoopPlayerMaxNum: '4',
  ServerPlayerMaxNum: '32',
  ServerName: 'Default Palworld Server',
  ServerDescription: '',
  AdminPassword: '',
  ServerPassword: '',
  PublicPort: '8211',
  PublicIP: '',
  RCONEnabled: 'False',
  RCONPort: '25575',
  Region: '',
  bUseAuth: 'True',
  BanListURL: 'https://api.palworldgame.com/api/banlist.txt',
};

export function readIniRaw(inst: Instance): string {
  if (!fs.existsSync(inst.settings_ini)) return '';
  return fs.readFileSync(inst.settings_ini, 'utf8');
}

export function writeIniRaw(inst: Instance, content: string): void {
  fs.writeFileSync(inst.settings_ini, content, 'utf8');
}

function parseOptionSettings(raw: string): Record<string, string> {
  const prefix = 'OptionSettings=(';
  const start = raw.indexOf(prefix);
  if (start === -1) return {};

  // Walk character-by-character so that ) inside quoted values (e.g.
  // CrossplayPlatforms="(Steam)") does NOT terminate the outer block early.
  let i = start + prefix.length;
  let inQuote = false;
  let inner = '';
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"')            { inQuote = !inQuote; inner += ch; }
    else if (ch === ')' && !inQuote) { break; }  // real closing paren
    else                       { inner += ch; }
    i++;
  }

  // Parse key=value pairs, respecting quoted values
  const result: Record<string, string> = {};
  let pos = 0;
  while (pos < inner.length) {
    // Skip commas/whitespace between pairs
    while (pos < inner.length && (inner[pos] === ',' || inner[pos] === ' ')) pos++;
    if (pos >= inner.length) break;

    // Key  (word chars only)
    const keyStart = pos;
    while (pos < inner.length && /\w/.test(inner[pos])) pos++;
    const key = inner.slice(keyStart, pos);
    if (!key || inner[pos] !== '=') break;
    pos++; // skip '='

    // Value — quoted or unquoted
    let value = '';
    if (inner[pos] === '"') {
      pos++; // skip opening "
      while (pos < inner.length && inner[pos] !== '"') {
        if (inner[pos] === '\\' && pos + 1 < inner.length) {
          value += inner[++pos]; // escaped char
        } else {
          value += inner[pos];
        }
        pos++;
      }
      if (pos < inner.length) pos++; // skip closing "
    } else {
      // Unquoted — read until next comma
      while (pos < inner.length && inner[pos] !== ',') value += inner[pos++];
    }

    if (key) result[key] = value;
  }
  return result;
}

// Fields that Palworld expects to always be double-quoted in the INI,
// regardless of their content (strings, URLs, IPs, passwords, etc.)
const QUOTED_FIELDS = new Set([
  'ServerName',
  'ServerDescription',
  'AdminPassword',
  'ServerPassword',
  'PublicIP',
  'Region',
  'BanListURL',
  'RandomizerSeed',
  'CrossplayPlatforms',
]);

function buildOptionSettings(settings: Record<string, string>): string {
  const entries = Object.entries(settings)
    .map(([k, v]) => {
      // Always quote fields in the whitelist; also quote anything that
      // contains commas, spaces, or parentheses (e.g. CrossplayPlatforms value)
      const needsQuotes = QUOTED_FIELDS.has(k) || /[,\s()]/.test(v);
      return `${k}=${needsQuotes ? `"${v}"` : v}`;
    })
    .join(',');
  return `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(${entries})`;
}

export function readSettings(inst: Instance): PalSettings {
  const raw = readIniRaw(inst);
  const parsed = parseOptionSettings(raw);
  return { ...DEFAULT_SETTINGS, ...parsed };
}

export function writeSettings(inst: Instance, settings: Partial<PalSettings>): void {
  const current = readSettings(inst);
  const merged: Record<string, string> = { ...current };
  for (const [k, v] of Object.entries(settings)) {
    if (v !== undefined) merged[k] = v;
  }
  writeIniRaw(inst, buildOptionSettings(merged));
}
