// src/features/credit/runner.ts
import {
  ChannelType, Events, type Client, type TextChannel
} from 'discord.js';
import { getChannelId, incCount, getCount } from './configStore.js';
import { CREDIT_REPLIES } from '@/constants/creditReplies.js';

const CHANNEL_NAME_TEMPLATE = '﹙⭐﹚ㆍเครดิตรีวิวㆍ{count}';
const REPLY_PROBABILITY = 1.0;   // ระหว่างเทสต์ให้ตอบทุกครั้ง (ปรับลดภายหลังได้)
const USER_COOLDOWN_MS = 3000;   // กันสแปมเล็กน้อย

const lastReplyAt = new Map<string, number>();    // key = guildId:userId
const lastRenameAt = new Map<string, number>();   // key = channelId
const RENAME_MIN_INTERVAL_MS = 2000;

export function attachCreditFeature(client: Client) {
  client.on(Events.MessageCreate, async (msg) => {
    if (!msg.guild || msg.author.bot) return;

    const targetId = getChannelId(msg.guild.id);
    if (!targetId) return;
    if (msg.channelId !== targetId) return;
    if (msg.channel.type !== ChannelType.GuildText) return;

    // 1) นับรีวิวเสมอ
    const newCount = incCount(msg.guild.id);

    // 2) ตอบเฉพาะ "ข้อความล่าสุดของคน" ในห้องนี้เท่านั้น
    //    - ดึงข้อความล่าสุด 10 อัน แล้วหา "ข้อความล่าสุดที่ไม่ใช่บอท"
    //    - ถ้าอันนั้นไม่ใช่ msg ปัจจุบัน -> ข้ามการ reply
    let isLatestHuman = false;
    try {
      const recent = await msg.channel.messages.fetch({ limit: 10 }).catch(() => null);
      if (recent) {
        const latestHuman = recent.find(m => !m.author.bot);
        isLatestHuman = latestHuman?.id === msg.id;
      }
    } catch { /* ignore */ }

    // เงื่อนไขตอบกลับ: ต้องเป็นข้อความล่าสุดของคน + ผ่านโอกาส + ผ่านคูลดาวน์
    const key = `${msg.guild.id}:${msg.author.id}`;
    const now = Date.now();
    const last = lastReplyAt.get(key) ?? 0;
    const shouldReply =
      isLatestHuman &&
      Math.random() < REPLY_PROBABILITY &&
      now - last >= USER_COOLDOWN_MS;

    if (shouldReply) {
      const text = CREDIT_REPLIES[Math.floor(Math.random() * CREDIT_REPLIES.length)];

      // ลบ "reply เดิมของบอทในห้อง" ให้เหลือแค่ของล่าสุด
      try {
        const recents = await msg.channel.messages.fetch({ limit: 50 }).catch(() => null);
        if (recents) {
          const oldBotReplies = recents.filter(m =>
            m.author?.id === client.user?.id &&
            m.reference?.messageId // เป็นข้อความแบบ reply
          );
          for (const m of oldBotReplies.values()) {
            // อย่าลบตัวเองล่วงหน้า (เผื่อมีเคสแรร์) — ที่นี่ยังไม่มีตัวใหม่ จึงลบได้เลยทั้งหมด
            await m.delete().catch(() => {});
          }
        }
      } catch { /* ignore */ }

      // ตอบเฉพาะข้อความล่าสุด
      try {
        await msg.reply({ content: text, allowedMentions: { repliedUser: false } });
        lastReplyAt.set(key, now);
      } catch { /* ignore */ }
    }

    // 3) รีเนมแบบไม่บล็อกงาน (ติด rate limit/ permission ก็ข้าม)
    const ch = msg.channel as TextChannel;
    const lastRename = lastRenameAt.get(ch.id) ?? 0;
    if (Date.now() - lastRename >= RENAME_MIN_INTERVAL_MS) {
      lastRenameAt.set(ch.id, Date.now());
      const newName = CHANNEL_NAME_TEMPLATE.replace('{count}', String(newCount));
      if (ch.name !== newName && typeof ch.setName === 'function') {
        (async () => {
          try { await ch.setName(newName); } catch { /* skip silently */ }
        })();
      }
    }
  });

  // sync ชื่อห้องตาม count ตอนบอทออนไลน์ (best-effort)
  client.once(Events.ClientReady, async () => {
    for (const [gid, guild] of client.guilds.cache) {
      const chId = getChannelId(gid);
      if (!chId) continue;
      const count = getCount(gid);
      try {
        const ch = await guild.channels.fetch(chId).catch(() => null);
        if (ch && ch.type === ChannelType.GuildText) {
          const textCh = ch as TextChannel;
          const newName = CHANNEL_NAME_TEMPLATE.replace('{count}', String(count));
          if (textCh.name !== newName) {
            try { await textCh.setName(newName); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
  });
}
