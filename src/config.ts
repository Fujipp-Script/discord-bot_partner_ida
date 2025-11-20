// src/config.ts
import fs from 'fs';
import path from 'path';

const FILE = path.resolve('data/config.json');

type TopupCfg = {
  firstRoleId?: string;
  upgradedRoleId?: string;
  thresholds?: { amount?: number; count?: number };
};
type GuildCfg = { topup?: TopupCfg };
type Store = Record<string, GuildCfg>;

function readStore(): Store {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function writeStore(s: Store) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), 'utf8');
}

export async function getGuildConfig(gid: string): Promise<GuildCfg> {
  const s = readStore();
  if (!s[gid]) {
    s[gid] = {
      topup: {
        firstRoleId: '1393550961984929853',
        upgradedRoleId: '1393550961984929853',
        thresholds: { amount: 2000, count: 5 }
      }
    };
    writeStore(s);
  }
  const g = s[gid]!;
  g.topup ||= {};
  g.topup.thresholds ||= { amount: 2000, count: 5 };
  g.topup.firstRoleId ||= '1393550961984929853';
  g.topup.upgradedRoleId ||= '1393550961984929853';
  return g;
}
