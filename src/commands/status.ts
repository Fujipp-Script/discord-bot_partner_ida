// src/commands/status.ts
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
  type TextChannel,
  type NewsChannel,
  type MessageCreateOptions,
  type MessageEditOptions,
} from 'discord.js';
import fs from 'fs';
import path from 'path';

// ===== Storage (migrate จาก notice_config.json ถ้ามี) =====
const STATUS_CFG = path.resolve('data/status_config.json');
const LEGACY_NOTICE_CFG = path.resolve('data/notice_config.json');

// NOTE: ค่าคงที่ห้องแชท/role ที่จะเปิด-ปิดสิทธิ์ ส่งข้อความ
const TALK_CHANNEL_ID = '1394637370246168576';
const TALK_ROLE_ID = '1268952275007832085';

type GuildCfg = { announceChannelId: string; messageId?: string };
type Store = Record<string, GuildCfg>;

function readStore(): Store {
  if (!fs.existsSync(STATUS_CFG) && fs.existsSync(LEGACY_NOTICE_CFG)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_NOTICE_CFG, 'utf-8'));
      const migrated: Store = {};
      for (const [gid, v] of Object.entries<any>(legacy || {})) {
        if (v?.announceChannelId) migrated[gid] = { announceChannelId: v.announceChannelId };
      }
      fs.mkdirSync(path.dirname(STATUS_CFG), { recursive: true });
      fs.writeFileSync(STATUS_CFG, JSON.stringify(migrated, null, 2));
    } catch { /* ignore */ }
  }
  if (!fs.existsSync(STATUS_CFG)) return {};
  try { return JSON.parse(fs.readFileSync(STATUS_CFG, 'utf-8')); } catch { return {}; }
}

function writeStore(s: Store) {
  fs.mkdirSync(path.dirname(STATUS_CFG), { recursive: true });
  fs.writeFileSync(STATUS_CFG, JSON.stringify(s, null, 2), 'utf-8');
}

function isSendable(ch: any): ch is { send: (arg: any) => Promise<any> } {
  return !!ch && typeof ch.send === 'function';
}

function thNow() {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bangkok', hour12: false
  }).format(new Date());
}

// ===== Helpers =====
function isAnnouncement(ch: GuildBasedChannel | null | undefined): ch is NewsChannel {
  return !!ch && (ch as any).type === ChannelType.GuildAnnouncement;
}
function isGuildText(ch: GuildBasedChannel | null | undefined): ch is TextChannel {
  return !!ch && (ch as any).type === ChannelType.GuildText;
}

// เปิด/ปิดสิทธิ์ SendMessages ให้ role ที่กำหนดในห้อง TALK_CHANNEL_ID
async function setRoleSendPermission(i: ChatInputCommandInteraction, canSend: boolean) {
  try {
    const guild = i.guild!;
    const me = await guild.members.fetchMe();
    if (!me.permissions.has('ManageChannels')) {
      await i.followUp({ ephemeral: true, content: '⚠️ บอทไม่มีสิทธิ์ **Manage Channels** จึงแก้สิทธิ์ห้องไม่ได้' }).catch(() => {});
      return false;
    }

    const ch = guild.channels.cache.get(TALK_CHANNEL_ID) as GuildBasedChannel | undefined;
    if (!isGuildText(ch)) {
      await i.followUp({ ephemeral: true, content: '⚠️ ไม่พบห้องแชท (TALK_CHANNEL_ID) หรือไม่ใช่ Text Channel' }).catch(() => {});
      return false;
    }

    await (ch as TextChannel).permissionOverwrites.edit(
      TALK_ROLE_ID,
      { SendMessages: canSend ? true : false } as any
    ).catch(() => {});

    return true;
  } catch {
    return false;
  }
}

// ========== แก้ Type ให้ใช้ร่วม send/edit ได้ ==========
type BasePayload = {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: MessageCreateOptions['components'];
  allowedMentions?: MessageCreateOptions['allowedMentions'];
};

// หา/สร้าง แล้ว "อัปเดตข้อความเดิม" (ถ้าไม่มีให้ส่งใหม่และจำ messageId)
async function upsertStatusMessage(
  i: ChatInputCommandInteraction,
  ch: GuildBasedChannel,
  store: Store,
  base: BasePayload
) {
  const gid = i.guildId!;
  const cfg = store[gid] || { announceChannelId: ch.id };
  let ok = false;

  // 1) ถ้ามี messageId เก่า -> พยายาม fetch แล้ว edit (ใช้ MessageEditOptions)
  if (cfg.messageId) {
    try {
      const text = ch as unknown as TextChannel;
      const msg = await text.messages.fetch(cfg.messageId);
      const editPayload: MessageEditOptions = {
        content: base.content,
        embeds: base.embeds,
        components: base.components,
        allowedMentions: base.allowedMentions,
      };
      await msg.edit(editPayload);
      ok = true;
    } catch {
      ok = false;
    }
  }

  // 2) ถ้าไม่มี/แก้ไม่ได้ -> ส่งใหม่ (ใช้ MessageCreateOptions) + เก็บ messageId
  if (!ok) {
    try {
      const sendPayload: MessageCreateOptions = {
        content: base.content,
        embeds: base.embeds,
        components: base.components,
        allowedMentions: base.allowedMentions,
      };
      const sent = await (ch as any).send(sendPayload);
      cfg.messageId = sent.id;
      store[gid] = { ...cfg, announceChannelId: ch.id };
      writeStore(store);
    } catch {
      // ส่งไม่ได้ก็ให้ caller แจ้ง error ต่อ
    }
  } else {
    store[gid] = { ...cfg, announceChannelId: ch.id };
    writeStore(store);
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('จัดการสถานะร้าน (ประกาศเปิด/ปิด + เปลี่ยนชื่อห้อง)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s =>
      s.setName('set')
        .setDescription('ตั้งห้องประกาศที่จะใช้สำหรับเปิด/ปิดร้าน')
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('ห้องประกาศ')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand(s => s.setName('open').setDescription('ประกาศ: ร้านเปิด'))
    .addSubcommand(s => s.setName('close').setDescription('ประกาศ: ร้านปิด')),

  cooldown: 3,

  async execute(i: ChatInputCommandInteraction) {
    const guildId = i.guildId!;
    const store = readStore();
    const sub = i.options.getSubcommand(true);

    await i.deferReply({ ephemeral: true });

    // /status set {channel}
    if (sub === 'set') {
      const ch = i.options.getChannel('channel', true) as GuildBasedChannel;
      store[guildId] = { announceChannelId: ch.id, messageId: undefined };
      writeStore(store);

      const embed = new EmbedBuilder()
        .setColor('#b8b8b8')
        .setTitle('ตั้งค่าห้องประกาศสถานะร้าน')
        .setDescription([`ห้องประกาศ: <#${ch.id}>`, `ปรับปรุงล่าสุด: ${thNow()}`].join('\n'));
      await i.editReply({ embeds: [embed] });
      return;
    }

    // ตรวจสอบห้องประกาศที่ตั้งไว้
    const cfg = store[guildId];
    const announceChannel = cfg ? i.client.channels.cache.get(cfg.announceChannelId) as GuildBasedChannel | undefined : undefined;
    if (!announceChannel || !isSendable(announceChannel)) {
      await i.editReply('❌ ยังไม่ตั้งห้องประกาศ หรือบอทส่งข้อความที่ห้องนั้นไม่ได้\nโปรดใช้ **/status set** ก่อน');
      return;
    }

    // /status open
    if (sub === 'open') {
      await setRoleSendPermission(i, true).catch(() => {});

      if (isAnnouncement(announceChannel) && typeof (announceChannel as any).setName === 'function') {
        await (announceChannel as any).setName('🟢ㆍสถานะㆍร้านเปิด').catch(() => {});
      }

      const embed = new EmbedBuilder()
        .setColor('#E784C2')
        .setTitle('<a:Ida_on:1303253267836567582> ร้านไอด้าเปิดให้บริการแล้ว')
        .setDescription([
          '<:3470blueberryheartu:1403751622642892830> ลูกค้าเลือกเซอร์วิสได้เลยย',
          'ติดตาม Stock เม็ดบูสต์ <a:Nitro:1303252956728135720>  <#1393542100121030676>'
        ].join('\n'))
        .setImage('https://img2.pic.in.th/pic/OPENED.gif')
        .setFooter({ text: 'IDAXDSHOP & SERVICES [ ยินดีต้อนรับเหล่า babiebunnie ที่น่ารักทุกคน ]' });

      const base: BasePayload = {
        content: `<a:dot:1400835527162204321>   ห้องทิกเก็ต <#1394669180921581731>\n<a:dot:1400835527162204321>   ห้องแชทสอบถาม <#1394637370246168576> \`› พิมพ์ได้เฉพาะตอนร้านเปิด\`\n||<@&1268952275007832085>||`,
        embeds: [embed],
        allowedMentions: { parse: [] }
      };

      await upsertStatusMessage(i, announceChannel, store, base);

      await i.editReply('✅ เปิดร้านแล้วในห้องที่ตั้งค่าไว้! (เปิดสิทธิ์พิมพ์ให้ role แล้ว / แก้ไขประกาศเดิม)');
      return;
    }

    // /status close
    if (sub === 'close') {
      await setRoleSendPermission(i, false).catch(() => {});

      if (isAnnouncement(announceChannel) && typeof (announceChannel as any).setName === 'function') {
        await (announceChannel as any).setName('🔴ㆍสถานะㆍร้านปิด').catch(() => {});
      }

      const embed = new EmbedBuilder()
        .setColor('#E91E63')
        .setTitle('<a:Ida_off:1303253337373802527>  ร้านไอด้าปิดให้บริการแล้วในเวลานี้')
        .setDescription([
          '╰┈➤ ลูกค้าที่เปิดทิกเก็ต**หลังร้านปิด** ไอด้าตื่นมาเคลียร์พรุ่งนี้น๊าา <a:kawaii_bow:1393983463320719481>',
          '𝗍𝗁𝖺𝗇𝗄 𝗊 𝖿𝗈𝗋 𝗌𝗎𝗉𝗉𝗈𝗋𝗍 <:1058253914262208643:1403751718910693417> อย่าลืมพักผ่อนกันด้วยนะค้าบบ.',
        ].join('\n'))
        .setImage('https://img2.pic.in.th/pic/CLOSEDcdd51fa053f06d4b.gif')
        .setFooter({ text: 'IDAXDSHOP & SERVICES [ ยินดีต้อนรับเหล่า babiebunnie ที่น่ารักทุกคน ]' });

      const base: BasePayload = {
        content: `||<@&1268952275007832085>||`,
        embeds: [embed],
        allowedMentions: { parse: [] }
      };

      await upsertStatusMessage(i, announceChannel, store, base);

      await i.editReply('🛑 ปิดร้านแล้ว และประกาศเรียบร้อย! (ปิดสิทธิ์พิมพ์ให้ role แล้ว / แก้ไขประกาศเดิม)');
      return;
    }

    await i.editReply('คำสั่งไม่ถูกต้อง');
  }
};
