// src/utils/topupStore.ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import {
  EmbedBuilder, Guild, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  type GuildMember, type Interaction, type Message
} from 'discord.js';
import { getGuildConfig } from '@/config.js';

type Entry = { amount: number; count: number };
type Store = Record<string, Entry>;

const FALLBACK_FIRST_ROLE_ID    = '1393550961984929853';
const FALLBACK_UPGRADED_ROLE_ID = '1393550961984929853';
export const TOP5_ROLE_ID = '1424057721212243978';
export const TOP1_ROLE_ID = '1424055332887334972';

function filePath(guildId: string) {
  return resolve('data/topup', `${guildId}.json`);
}

async function resolveDisplayName(guild: Guild | null | undefined, userId: string) {
  if (guild) {
    const m = await guild.members.fetch(userId).catch(() => null);
    if (m) return m.displayName || m.user.globalName || m.user.username;
  }
  const u = await guild?.client.users.fetch(userId).catch(() => null);
  return u?.globalName || u?.username || `<@${userId}>`;
}

export async function loadData(guildId: string): Promise<Store> {
  try {
    const p = filePath(guildId);
    const raw = JSON.parse(await readFile(p, 'utf-8')) as any;
    const out: Store = {};
    for (const [uid, v] of Object.entries(raw || {})) {
      if (typeof v === 'number') out[uid] = { amount: v as number, count: 0 };
      else out[uid] = { amount: Number((v as any).amount) || 0, count: Number((v as any).count) || 0 };
    }
    return out;
  } catch { return {}; }
}

export async function saveData(guildId: string, data: Store) {
  const p = filePath(guildId);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2), 'utf-8');
}

export function ensureUser(data: Store, userId: string) {
  if (!data[userId]) data[userId] = { amount: 0, count: 0 };
  return data[userId];
}

export function sortEntries(data: Store) {
  return Object.entries(data).sort((a, b) => (b[1].amount - a[1].amount));
}

function thNow() {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bangkok', hour12: false
  }).format(new Date());
}

// ---- Roles / Thresholds ----
function getTopupCfg(cfg: any) {
  const t = cfg?.topup || {};
  return {
    firstRoleId: t.firstRoleId || FALLBACK_FIRST_ROLE_ID,
    upgradedRoleId: t.upgradedRoleId || FALLBACK_UPGRADED_ROLE_ID,
    thresholds: {
      amount: Number(t?.thresholds?.amount ?? 2000),
      count: Number(t?.thresholds?.count ?? 5),
    }
  };
}

export function shouldUpgrade(e: Entry, cfg?: any) {
  const th = (cfg?.thresholds) ?? { amount: 2000, count: 5 };
  return e.amount >= th.amount || e.count >= th.count;
}

// ✅ แจก “ยศแรกเริ่ม” แบบปลอดภัย (เช็ก role/permission/hierarchy)
export async function giveFirstRoleIfNeed(member: GuildMember) {
  const cfg = getTopupCfg(await getGuildConfig(member.guild.id));
  const roleId = cfg.firstRoleId;
  if (!roleId) return;

  const role = member.guild.roles.cache.get(roleId);
  if (!role) { console.warn(`[topup:firstRole] Role not found: ${roleId}`); return; }

  const me = await member.guild.members.fetchMe();
  const canManage = me.permissions.has('ManageRoles') && (me.roles.highest.comparePositionTo(role) > 0);
  if (!canManage) { console.warn(`[topup:firstRole] No perm/hierarchy for ${role.name} (${role.id})`); return; }

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role.id).catch(e => console.warn(`[topup:firstRole] add failed:`, e?.message || e));
  }
}

// ✅ แจก “ยศอัปเกรด” แบบปลอดภัย
export async function giveUpgradeIfNeed(member: GuildMember) {
  const cfg = getTopupCfg(await getGuildConfig(member.guild.id));
  const roleId = cfg.upgradedRoleId;
  if (!roleId) return;

  const role = member.guild.roles.cache.get(roleId);
  if (!role) { console.warn(`[topup:upgradedRole] Role not found: ${roleId}`); return; }

  const me = await member.guild.members.fetchMe();
  const canManage = me.permissions.has('ManageRoles') && (me.roles.highest.comparePositionTo(role) > 0);
  if (!canManage) { console.warn(`[topup:upgradedRole] No perm/hierarchy for ${role.name} (${role.id})`); return; }

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role.id).catch(e => console.warn(`[topup:upgradedRole] add failed:`, e?.message || e));
  }
}

// utils/topupStore.ts  👉 แทนที่ทั้งฟังก์ชันนี้
export async function refreshTopupRanks(guild: Guild) {
  const data = await loadData(guild.id);

  // === จัดอันดับ: amount มาก -> น้อย, เสมอให้ดู count มากกว่า, แล้วค่อย userId ===
  const sorted = Object.entries(data).sort((a, b) => {
    const byAmount = b[1].amount - a[1].amount;
    if (byAmount !== 0) return byAmount;
    const byCount = b[1].count - a[1].count;
    if (byCount !== 0) return byCount;
    return a[0].localeCompare(b[0]);
  });

  const top1UserId = sorted[0]?.[0];
  const top5UserIds = new Set(sorted.slice(0, 5).map(([uid]) => uid));

  // อันดับ 1 ได้ทั้ง Top1 + Top5 ตามที่ต้องการ
  const includeTop1InTop5 = false;
  if (!includeTop1InTop5 && top1UserId) {
    top5UserIds.delete(top1UserId);
  }

  const roleTop1 = guild.roles.cache.get(TOP1_ROLE_ID) || null;
  const roleTop5 = guild.roles.cache.get(TOP5_ROLE_ID) || null;

  // helper: fetch รายคนเพื่อกัน cache หลุด
  const ensureMember = async (id: string) => guild.members.fetch(id).catch(() => null);

  // ===== Top1 =====
  if (roleTop1) {
    // ถอดทุกคนที่ถือ Top1 อยู่ แต่ไม่ใช่อันดับ 1 แล้ว
    for (const [mid, member] of roleTop1.members) {
      if (mid !== top1UserId && member.roles.cache.has(roleTop1.id)) {
        await member.roles.remove(roleTop1).catch(() => {});
      }
    }
    // ให้ยศ Top1 กับอันดับ 1
    if (top1UserId) {
      const m = await ensureMember(top1UserId);
      if (m && !m.roles.cache.has(roleTop1.id)) {
        await m.roles.add(roleTop1).catch(() => {});
      }
    }
  }

  // ===== Top5 (ต้องเหลือ 5 คนเป๊ะ รวมอันดับ 1 ด้วยถ้า includeTop1InTop5 = true) =====
  if (roleTop5) {
    // ถอดคนที่มี role แต่ไม่อยู่ใน Top5 ชุดใหม่
    for (const [mid, member] of roleTop5.members) {
      if (!top5UserIds.has(mid) && member.roles.cache.has(roleTop5.id)) {
        await member.roles.remove(roleTop5).catch(() => {});
      }
    }
    // ให้ role กับคนที่อยู่ใน Top5 แต่ยังไม่มี
    for (const uid of top5UserIds) {
      const m = await ensureMember(uid);
      if (m && !m.roles.cache.has(roleTop5.id)) {
        await m.roles.add(roleTop5).catch(() => {});
      }
    }
  }
}



// ---- Business ----
export async function addAmount(guildId: string, userId: string, amount: number) {
  const data = await loadData(guildId);
  const e = ensureUser(data, userId);
  const isFirstTime = e.count === 0;
  e.amount += amount;
  e.count += 1;
  await saveData(guildId, data);
  return { entry: e, isFirstTime };
}

export async function listPageEmbed(guildId: string, page: number, size = 20) {
  const data = await loadData(guildId);
  const sorted = sortEntries(data);
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const cur = Math.min(Math.max(1, page), pages);
  const start = (cur - 1) * size;
  const items = sorted.slice(start, start + size);

  const lines = items.map(([uid, e], idx) => {
    const n = start + idx + 1;
    return `\`${n}.\` <@${uid}> → \`${e.amount} บาท\` • \`${e.count} ครั้ง\``;
  });
  const embed = new EmbedBuilder()
    .setColor('#E46DAF')
    .setTitle('<:Customer_1:1397770440293879991> อันดับการใช้เงิน')
    .setDescription(lines.join('\n') || '— ว่าง —')
    .setFooter({ text: `page ${cur}/${pages}` })
    .setTimestamp(new Date());

  return { embed, page: cur, pages };
}

export function pageControls(page: number, pages: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('topup_list_prev')
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId('topup_list_next')
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pages)
  );
}
export function parsePageFromEmbed(msg: Message) {
  const ft = msg.embeds?.[0]?.footer?.text || '';
  const m = ft.match(/page\s+(\d+)\/(\d+)/i);
  const page = m ? Number(m[1]) : 1;
  const pages = m ? Number(m[2]) : 1;
  return { page, pages };
}

export async function totalEmbed(guildId: string) {
  const data = await loadData(guildId);
  let totalAmount = 0, totalCount = 0;
  for (const e of Object.values(data)) { totalAmount += e.amount || 0; totalCount += e.count || 0; }
  return new EmbedBuilder()
    .setColor('#E46DAF')
    .setTitle('<:Treasure:1398066484911276082> ยอดรวมทั้งหมด')
    .setDescription(`รวมยอดเงินทั้งหมด: \`${totalAmount}\` บาท\nรวมจำนวนครั้งทั้งหมด: \`${totalCount}\` ครั้ง`)
    .setTimestamp(new Date());
}

// --- helper: รูปโปรไฟล์ (Member > User > ไม่มีรูป) ---
async function resolveAvatarUrl(i: Interaction, guild: Guild | null | undefined, userId: string) {
  try {
    if (guild) {
      const m = await guild.members.fetch(userId).catch(() => null);
      if (m) return m.displayAvatarURL({ size: 256 });
    }
    // fallback: users API
    // @ts-ignore
    const u = await (i.client as any).users.fetch(userId).catch(() => null);
    if (u) return u.displayAvatarURL({ size: 256 });
  } catch {}
  return undefined;
}

// ---- Embeds (ใหม่=ครั้งแรก, เก่า=ครั้งถัดไป) พร้อม avatar เป็น thumbnail ----
export async function buildCardEmbed(
  i: Interaction,
  userId: string,
  todayAmount: number,
  totalAmount: number,
  totalCount: number,
  isFirst: boolean
) {
  const guild = (i as any).guild ?? null;
  const name = await resolveDisplayName(guild, userId);
  const avatar = await resolveAvatarUrl(i, guild, userId);

  const COLOR_FIRST = 16761571; // ใหม่
  const COLOR_NEXT  = 14970287; // เก่า

  const firstTitle = `<:17106ginghamheartpink:1416825175818895370>  บัตรสมาชิกร้านไอด้า ของคุณ ${name}`;
  const firstDesc =
    `<a:35301pinkclouds:1416827854343245895>   𝖶𝖾𝗅𝖼𝗈𝗆𝖾 𝗇𝖾𝗐 𝗆𝖾𝗆𝖻𝖾𝗋  <a:35301pinkclouds:1416827854343245895>\n` +
    `୭˚. ᵎᵎ <a:money4:1405847976701726750> ﹕ค่าใช้จ่ายรอบนี้﹕\`${todayAmount}\`    บาท \n\n` +
    // `<a:zodiac14:1411567442139807784>  <a:58227buyingyourlove:1416822121732243456> ลูกค้าสะสมทั้งหมด \`${totalCount}\` ครั้ง <a:zodiac14:1411567442139807784> \n\n` +
    `**‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿**\n\n` +
    `<a:1057688178619846767:1409764570003935374> ลูกค้าที่มียอดสะสมจนติด **TOP 5** มีสิทธิ์รับส่วนลด\nและสิทธิ์พิเศษอื่นๆ จนกว่ายศจะหาย\n` +
    `<:lovecloud:1420423379940413571> สามารถอ่านรายละเอียดได้ที่ห้อง <#1403379291709902939> \n\n` +
    `ㅤㅤㅤㅤㅤ╭────── · · ୨୧ · · ──────╮\n` +
    `ㅤㅤㅤㅤㅤ ᴛʜᴀɴᴋ ʏᴏᴜ ꜰᴏʀ ꜱᴜᴘᴘᴏʀᴛ ᴍᴇ.\n` +
    `ㅤㅤㅤㅤㅤ╰────── · · ୨୧ · · ──────╯\n`;

  const nextTitle = `<:17106ginghamheartpink:1416825175818895370> บัตรสมาชิกร้านไอด้า ของคุณ ${name}`;
  const nextDesc =
    `<a:35301pinkclouds:1416827854343245895>  ขอบคุณสำหรับการกลับมาใช้บริการอีกครั้ง <a:35301pinkclouds:1416827854343245895>\n` +
    `୭˚. ᵎᵎ <a:money4:1405847976701726750> ﹕ค่าใช้จ่ายรอบนี้﹕\`${todayAmount}\`    บาท \n` +
    `<a:60225flyingheartspinkx02:1416825999647178752>  รวมยอดสะสมทั้งหมดของลูกค้า﹕ \`${totalAmount}\`  บาท\n` +
    `**‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿**\n\n` +
    // `<a:zodiac14:1411567442139807784>  <a:58227buyingyourlove:1416822121732243456> ลูกค้าสะสมทั้งหมด \`${totalCount}\` ครั้ง <a:zodiac14:1411567442139807784> \n` +
    // `**‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿‿**\n\n` +
    `\n` +
    `<a:1057688178619846767:1409764570003935374> ลูกค้าที่มียอดสะสมจนติด **TOP 5** มีสิทธิ์รับส่วนลด\nและสิทธิ์พิเศษอื่นๆ จนกว่ายศจะหาย\n` +
    `<:lovecloud:1420423379940413571> สามารถอ่านรายละเอียดได้ที่ห้อง <#1403379291709902939> \n\n` +
    `ㅤㅤㅤㅤㅤ╭────── · · ୨୧ · · ──────╮\n`  +
    `ㅤㅤㅤㅤㅤ ᴛʜᴀɴᴋ ʏᴏᴜ ꜰᴏʀ ꜱᴜᴘᴘᴏʀᴛ ᴍᴇ.\n` +
    `ㅤㅤㅤㅤㅤ╰────── · · ୨୧ · · ──────╯\n`;

  const embed = new EmbedBuilder()
    .setColor(isFirst ? COLOR_FIRST : COLOR_NEXT)
    .setTitle(isFirst ? firstTitle : nextTitle)
    .setDescription(isFirst ? firstDesc : nextDesc)
    .setTimestamp(new Date());

  if (avatar) embed.setThumbnail(avatar);
  return embed;
}

// ---- Utils ----
export function toUserId(input?: string) {
  if (!input) return '';
  const m = input.match(/\d{16,20}/g);
  return m?.[0] ?? '';
}

export function buildInfoEmbed(title: string, description: string, color: number = 0x00AE86) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}
