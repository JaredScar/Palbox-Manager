export interface Instance {
  id: number;
  name: string;
  service_name: string;
  exe_path: string;
  save_dir: string;
  backup_dir: string;
  settings_ini: string;
  log_file: string;
  rcon_host: string;
  rcon_port: number;
  rcon_password: string;
  public_ip: string;
  game_port: number;
  steamcmd_exe: string;
  mods_dir: string;
  created_at: number;
}

export interface RconMacro {
  id: number;
  instance_id: number;
  name: string;
  command: string;
  description: string;
  color: string;
  sort_order: number;
  created_at: number;
}

export interface BroadcastSchedule {
  id: number;
  instance_id: number;
  name: string;
  message: string;
  cron: string;
  enabled: number;
  created_at: number;
}

export interface AlertRule {
  id: number;
  instance_id: number;
  name: string;
  metric: 'cpu' | 'memory' | 'players' | 'status';
  operator: 'gt' | 'lt' | 'eq';
  threshold: number;
  cooldown_m: number;
  enabled: number;
  last_fired: number | null;
  created_at: number;
}

export interface AuditEntry {
  id: number;
  instance_id: number | null;
  actor: string;
  action: string;
  detail: string;
  created_at: number;
}

export interface ChatMessage {
  id: number;
  instance_id: number;
  player_name: string;
  content: string;
  captured_at: number;
}

export interface BackupScheduleConfig {
  instance_id: number;
  frequency: 'off' | 'hourly' | 'daily' | 'weekly';
  hour: number;
  day_of_week: number;
  enabled: number;
}
