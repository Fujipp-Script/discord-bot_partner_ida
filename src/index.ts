// src/index.ts
import 'dotenv/config';
import os from 'os';
import {
  ActivityType, Client, GatewayIntentBits, Partials, Collection, REST, Routes, Events,
  type ChatInputCommandInteraction, type GuildTextBasedChannel
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import './server.js'; // start express keep-alive
import { pathToFileURL } from 'url';

// ===== Features / handlers ที่ต้องใช้ =====
import { attachCreditFeature } from '@/features/credit/runner.js';
import { getPendingMap } from '@/commands/message.js';
import {
  parsePageFromEmbed, pageControls, listPageEmbed,
  loadData, saveData, toUserId, buildInfoEmbed, refreshTopupRanks
} from '@/utils/topupStore.js';
import { attachVoiceKeeper } from '@/features/voice/voiceKeeper.js';

const TOKEN    = process.env.TOKEN!;
const APP_ID   = process.env.APP_ID!;
const GUILD_ID = process.env.GUILD_ID;


if (!TOKEN || !APP_ID) {
  console.error('❌ Missing TOKEN or APP_ID in .env');
  process.exit(1);
}

type CommandMod = {
  data: any; // SlashCommandBuilder
  execute: (i: ChatInputCommandInteraction) => Promise<any> | any;
  checkPermissions?: (i: ChatInputCommandInteraction) => Promise<any> | any;
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // ✅ สำหรับ /join, /leave
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User]
}) as any;

client.commands = new Collection<string, CommandMod>();

// helper: ลอง import ทั้งแบบพาธไฟล์ปกติ และแบบ file:// URL
async function dynamicImportSmart(filePath: string) {
  // 1) พยายาม import ด้วย path ตรงๆ ก่อน (เผื่อเป็น CJS/Bundler บางกรณี)
  try {
    return await import(filePath);
  } catch {
    // 2) ถ้าไม่รอด ค่อยแปลงเป็น file:// URL สำหรับ ESM
    const asUrl = pathToFileURL(filePath).href;
    return await import(asUrl);
  }
}

/** โหลดคำสั่งทั้งหมดจาก src/commands หรือ dist/commands */
async function loadCommands(): Promise<any[]> {
  const baseDir = process.cwd();

  const distDir = path.join(baseDir, 'dist', 'commands');
  const srcDir  = path.join(baseDir, 'src',  'commands');

  // ใช้ dist เวลา runtime/prod, ถ้าไม่มีค่อย fallback src (รองรับ dev ด้วย tsx)
  const preferDist = fs.existsSync(distDir);
  const commandsDir = preferDist
    ? distDir
    : (fs.existsSync(srcDir) ? srcDir : null);

  if (!commandsDir) {
    console.warn('ℹ️ commands directory not found in dist or src, skipping load.');
    return [];
  }

  const allowExts = preferDist ? ['.js'] : ['.ts', '.js'];
  const files = fs
    .readdirSync(commandsDir)
    .filter(f => allowExts.some(ext => f.endsWith(ext)));

  const jsonDatas: any[] = [];

  for (const f of files) {
    const filePath = path.join(commandsDir, f);
    try {
      const raw = await dynamicImportSmart(filePath);
      const mod: any = raw?.default ?? raw;

      if (!mod?.data || !mod?.execute) {
        console.warn(`⚠️ Skip ${f} (no data/execute)`);
        continue;
      }
      const name = mod.data?.toJSON?.().name ?? mod.data?.name;
      if (!name) {
        console.warn(`⚠️ Skip ${f} (cannot infer command name)`);
        continue;
      }

      console.log(`➡️  Loaded command from ${f}: /${name}`);
      (client as any).commands.set(name, mod);
      jsonDatas.push(mod.data.toJSON ? mod.data.toJSON() : mod.data);
    } catch (e: any) {
      console.error(`❌ Failed to load command file ${f}:`, e?.stack || e?.message || e);
    }
  }

  console.log(`✅ Loaded ${(client as any).commands.size} command(s).`);
  return jsonDatas;
}

/** ลงทะเบียน Slash Commands (Guild ถ้ามี GUILD_ID ไม่งั้น Global) */
async function registerCommands(payload: any[]) {
  if (!payload.length) {
    console.warn('⚠️ No commands to register (payload is empty). Check loader logs above.');
  } else {
    const names = payload.map((p: any) => p.name).join(', ');
    console.log(`📝 Will register commands: ${names}`);
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: payload });
    console.log(`🛠️  Registered ${payload.length} guild command(s) to ${GUILD_ID}.`);
  } else {
    await rest.put(Routes.applicationCommands(APP_ID), { body: payload });
    console.log(`🛠️  Registered ${payload.length} global command(s).`);
  }
}

// === Presence helpers ===
function formatBytes(n: number) {
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

function formatDuration(sec: number) {
  const d = Math.floor(sec / 86400); sec -= d * 86400;
  const h = Math.floor(sec / 3600);  sec -= h * 3600;
  const m = Math.floor(sec / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}


/** วน Presence: 3 รายการตามสเปค */
function startPresenceRotator(client: Client, intervalMs = 20000) {
  const makers = [
    () => ({ name: 'discord.gg/idaxdshop', type: ActivityType.Watching as const }),
    () => {
      const ping = Math.round(client.ws.ping);
      const mem = formatBytes(process.memoryUsage().rss);
      const load1 = (os.loadavg?.()[0] ?? 0).toFixed(2);
      return { name: `Ping ${ping}ms • RAM ${mem} • Load ${load1}`, type: ActivityType.Watching as const };
    },
    // ✅ เพิ่มอันนี้: Uptime ของบอท (นับตั้งแต่โปรเซสรัน)
    () => {
      const uptimeSec = Math.floor(process.uptime());
      return { name: `Uptime ${formatDuration(uptimeSec)}`, type: ActivityType.Watching as const };
    },
  ];

  let idx = 0;
  const apply = () => {
    const m = makers[idx % makers.length]();
    client.user?.setPresence({ status: 'online', activities: [m] });
    idx++;
  };

  apply();
  return setInterval(apply, intervalMs);
}

async function main() {
  const payload = await loadCommands();

  client.once(Events.ClientReady, async () => {
  console.log(`🤖 Logged in as ${client.user!.tag}`);

  // ✅ วน 3 อย่าง: (1) ลิงก์, (2) DEV BY FUJIPP, (3) realtime status
  startPresenceRotator(client, 20000); // ปรับช่วงเวลาได้

  // ✅ ฟีเจอร์อื่น ๆ
  attachCreditFeature(client);
  attachVoiceKeeper(client);

  try {
    await registerCommands(payload);
    console.log('✅ Commands are ready.');
  } catch (e: any) {
    console.error('❌ Failed to register commands:', e?.message || e);
  }
});


  // ===== Router หลัก =====
  client.on(Events.InteractionCreate, async (i: any) => {
    // --- Chat input commands ---
    if (i.isChatInputCommand()) {
      const cmd = client.commands.get(i.commandName) as CommandMod | undefined;
      if (!cmd) return;

      try {
        if (cmd.checkPermissions) await cmd.checkPermissions(i);
      } catch (err: any) {
        return i.reply({ ephemeral: true, content: err?.message || '⛔ ไม่มีสิทธิ์ใช้งานคำสั่งนี้' }).catch(()=>{});
      }

      try {
        await cmd.execute(i);
      } catch (err) {
        console.error(`❌ Command ${i.commandName} failed:`, err);
        await i.reply({ ephemeral: true, content: '❌ คำสั่งล้มเหลว กรุณาลองใหม่' }).catch(()=>{});
      }
      return;
    }

    // --- Modal: /message send -> message_send:<token> ---
    if (i.isModalSubmit() && typeof i.customId === 'string' && i.customId.startsWith('message_send:')) {
      const token = i.customId.split(':')[1];
      const map = getPendingMap(i.client);
      const pending = map.get(token);

      if (!pending) {
        await i.reply({ ephemeral: true, content: '❌ ไม่พบข้อมูลชั่วคราว (modal หมดอายุหรือบอทรีสตาร์ท)' }).catch(()=>{});
        return;
      }

      const content = (i.fields.getTextInputValue('message_content') || '').slice(0, 2000);
      if (!content) {
        await i.reply({ ephemeral: true, content: '❌ ต้องกรอกข้อความก่อนส่ง' }).catch(()=>{});
        return;
      }

      try {
        let ch = i.client.channels.cache.get(pending.channelId) as any;
        if (!ch) ch = await i.client.channels.fetch(pending.channelId).catch(() => null);
        if (!ch || !('send' in ch) || typeof ch.send !== 'function') {
          await i.reply({ ephemeral: true, content: '❌ ห้องปลายทางไม่รองรับการส่งข้อความ' }).catch(()=>{});
          return;
        }

        const files = pending.files?.length
          ? pending.files.map(f => ({ attachment: f.url, name: f.name }))
          : undefined;

        const sent = await (ch as GuildTextBasedChannel).send({ content, files }).catch(() => null);
        if (!sent) {
          await i.reply({ ephemeral: true, content: '❌ ส่งข้อความไม่สำเร็จ (ตรวจสอบสิทธิ์/ข้อจำกัดของห้อง)' }).catch(()=>{});
          return;
        }

        // ล้าง state ของ modal นี้ออก
        map.delete(token);
        await i.reply({ ephemeral: true, content: `✅ ส่งข้อความเรียบร้อย: ${sent.url}` }).catch(()=>{});
      } catch (err) {
        console.error('modal message_send error:', err);
        await i.reply({ ephemeral: true, content: '❌ เกิดข้อผิดพลาดระหว่างส่งข้อความ' }).catch(()=>{});
      }
      return;
    }

    // --- Modal: /message edit -> message_edit:<messageId> ---
    if (i.isModalSubmit() && typeof i.customId === 'string' && i.customId.startsWith('message_edit:')) {
      const messageId = i.customId.split(':')[1];
      const ch = i.channel;
      if (!ch || !ch.isTextBased()) {
        await i.reply({ ephemeral: true, content: '❌ ใช้ได้เฉพาะในห้องข้อความ' }).catch(()=>{});
        return;
      }

      const newContent = (i.fields.getTextInputValue('new_content') || '').slice(0, 2000);
      if (!newContent) {
        await i.reply({ ephemeral: true, content: '❌ ต้องกรอกข้อความใหม่' }).catch(()=>{});
        return;
      }

      try {
        const msg = await (ch as GuildTextBasedChannel).messages.fetch(messageId);
        if (msg.author?.id !== i.client.user?.id) {
          await i.reply({ ephemeral: true, content: '❌ แก้ได้เฉพาะข้อความที่บอทเป็นคนส่งเท่านั้น' }).catch(()=>{});
          return;
        }
        await msg.edit({ content: newContent });
        await i.reply({ ephemeral: true, content: '✅ แก้ไขข้อความเรียบร้อย' }).catch(()=>{});
      } catch (err) {
        console.error('modal message_edit error:', err);
        await i.reply({ ephemeral: true, content: '❌ ไม่พบข้อความที่จะแก้ไขในห้องนี้' }).catch(()=>{});
      }
      return;
    }

    // --- Modal: /topup update -> modal_topup_update ---
    if (i.isModalSubmit() && i.customId === 'modal_topup_update') {
      const uid = i.fields.getTextInputValue('user_id');
      const amountStr = i.fields.getTextInputValue('amount');
      const countStr  = i.fields.getTextInputValue('count');
      const userId = toUserId(uid);
      if (!userId) {
        await i.reply({ ephemeral: true, content: '❌ user ไม่ถูกต้อง' }).catch(()=>{});
        return;
      }

      try {
        const data = await loadData(i.guildId!);
        if (!data[userId]) data[userId] = { amount: 0, count: 0 };
        if (amountStr) data[userId].amount = Math.max(0, Number(amountStr) || 0);
        if (countStr)  data[userId].count  = Math.max(0, Number(countStr) || 0);
        await saveData(i.guildId!, data);
        await refreshTopupRanks(i.guild!);
        await i.reply({
          ephemeral: true,
          embeds: [buildInfoEmbed('✅ อัปเดตสำเร็จ', `<@${userId}> ⇒ \`${data[userId].amount}\` บาท • \`${data[userId].count}\` ครั้ง`)]
        }).catch(()=>{});
      } catch (err) {
        console.error('modal_topup_update error:', err);
        await i.reply({ ephemeral: true, content: '❌ อัปเดตไม่สำเร็จ' }).catch(()=>{});
      }
      return;
    }

    // --- Buttons: topup list pagination ---
    if (i.isButton() && (i.customId === 'topup_list_prev' || i.customId === 'topup_list_next')) {
      const msg = i.message;
      const { page, pages } = parsePageFromEmbed(msg);
      const next = i.customId.endsWith('prev') ? Math.max(1, page-1) : Math.min(pages, page+1);
      const { embed } = await listPageEmbed(i.guildId!, next, 20);
      await i.update({ embeds: [embed], components: [pageControls(next, pages)] }).catch(()=>{});
      return;
    }
  });

  await client.login(TOKEN);
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
