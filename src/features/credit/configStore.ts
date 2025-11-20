// src/features/credit/configStore.ts
import fs from 'fs';
import path from 'path';

const FILE = path.resolve('data/credit_config.json');

type GuildCfg = {
  channelId: string;
  count: number; // นับรีวิวทั้งหมด
};
type Store = Record<string, GuildCfg>;

function readStore(): Store {
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, 'utf-8')); } catch { return {}; }
}
function writeStore(s: Store) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), 'utf-8');
}

export function getChannelId(guildId: string): string | null {
  const s = readStore();
  return s[guildId]?.channelId ?? null;
}
export async function setChannelId(gid: string, chId: string) {
  const s = readStore();
  if (!s[gid]) s[gid] = { channelId: chId, count: 0 };
  else s[gid].channelId = chId;
  writeStore(s);
}

export function getCount(guildId: string): number {
  const s = readStore();
  return s[guildId]?.count ?? 0;
}
export function incCount(guildId: string): number {
  const s = readStore();
  if (!s[guildId]) s[guildId] = { channelId: '', count: 0 };
  s[guildId].count = (s[guildId].count ?? 0) + 1;
  writeStore(s);
  return s[guildId].count;
}
