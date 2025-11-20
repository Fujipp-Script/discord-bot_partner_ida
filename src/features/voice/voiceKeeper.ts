import fs from 'fs';
import path from 'path';
import { ChannelType, Client, Events, PermissionFlagsBits } from 'discord.js';
import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection
} from '@discordjs/voice';

const STORE_FILE = path.resolve('data/voice_keeper.json');

type KeepCfg = { channelId: string; enabled: boolean };
type Store = Record<string, KeepCfg>;

function readStore(): Store {
  if (!fs.existsSync(STORE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')); } catch { return {}; }
}
function writeStore(s: Store) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2), 'utf-8');
}

const connCache = new Map<string, VoiceConnection>(); // guildId -> connection
const rejoinCooldownAt = new Map<string, number>();   // guildId -> ts ms
const REJOIN_COOLDOWN_MS = 5_000;
const HEARTBEAT_MS = 30 * 60 * 1000; // ⏱️ 30 นาที

export function enableKeep(guildId: string, channelId: string) {
  const s = readStore();
  s[guildId] = { channelId, enabled: true };
  writeStore(s);
}
export function disableKeep(guildId: string) {
  const s = readStore();
  const old = s[guildId];
  if (old) { old.enabled = false; writeStore(s); }
}

async function safeJoin(client: Client, guildId: string, channelId: string) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) return;

  // ตรวจสิทธิ์
  const me = await guild.members.fetchMe().catch(() => null);
  if (!me) return;
  const perms = (channel as any).permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.Connect)) return;

  // ปิด connection เดิมก่อน (กันซ้อน)
  try { getVoiceConnection(guildId)?.destroy(); } catch {}
  connCache.delete(guildId);

  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator: guild.voiceAdapterCreator as any,
    selfDeaf: true,
    selfMute: true,
  });
  connCache.set(guildId, connection);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 7_500);
  } catch { /* ถ้าไม่ Ready ก็ปล่อยให้ heartbeat/rejoin ช่วยซ่อม */ }
}

function scheduleRejoin(client: Client, guildId: string, channelId: string) {
  const now = Date.now();
  const last = rejoinCooldownAt.get(guildId) ?? 0;
  if (now - last < REJOIN_COOLDOWN_MS) return;
  rejoinCooldownAt.set(guildId, now);
  (async () => { try { await safeJoin(client, guildId, channelId); } catch {} })();
}

// ✅ บูตระบบทันที (ใช้ได้ทั้งก่อน/หลัง login)
function bootKeepers(client: Client) {
  const s = readStore();
  for (const [gid, cfg] of Object.entries(s)) {
    if (cfg?.enabled && cfg?.channelId) {
      scheduleRejoin(client, gid, cfg.channelId);
    }
  }
}

// ⏱️ heartbeat 30 นาที: ถ้าหลุด/อยู่ห้องผิด → พากลับ
function startHeartbeat(client: Client) {
  setInterval(() => {
    const s = readStore();
    for (const [gid, cfg] of Object.entries(s)) {
      if (!cfg?.enabled || !cfg?.channelId) continue;
      const conn = getVoiceConnection(gid);
      const connectedCh = (conn as any)?.joinConfig?.channelId as string | undefined;

      if (!conn || connectedCh !== cfg.channelId) {
        scheduleRejoin(client, gid, cfg.channelId);
      }
    }
  }, HEARTBEAT_MS);
}

export function attachVoiceKeeper(client: Client) {
  // 1) ถ้าพร้อมแล้ว บูตเลย ไม่รอ ClientReady
  if ((client as any).isReady?.() || client.readyAt) {
    bootKeepers(client);
    startHeartbeat(client);
  } else {
    // 2) ยังไม่พร้อม → บูตตอนพร้อมครั้งแรก
    client.once(Events.ClientReady, () => {
      bootKeepers(client);
      startHeartbeat(client);
    });
  }

  // 3) ถ้าบอทถูกเตะ/ย้าย/หลุด → รีจอยกลับห้องที่ตั้งไว้
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guildId = newState.guild.id;
    const s = readStore();
    const cfg = s[guildId];
    if (!cfg?.enabled || !cfg?.channelId) return;

    const botId = client.user?.id;
    if (!botId) return;
    const changedUserId = newState.id ?? oldState.id;
    if (changedUserId !== botId) return;

    const isDisconnected = !newState.channelId && !!oldState.channelId;
    const movedAway = !!newState.channelId && newState.channelId !== cfg.channelId;

    if (isDisconnected || movedAway) {
      scheduleRejoin(client, guildId, cfg.channelId);
    }
  });
}

export function currentConnection(guildId: string) {
  return getVoiceConnection(guildId) ?? connCache.get(guildId);
}
