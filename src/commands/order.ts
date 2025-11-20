// src/commands/order.ts
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Attachment,
  type GuildTextBasedChannel,
  type GuildBasedChannel,
} from 'discord.js';
import fs from 'fs';
import path from 'path';

const LOG_CHANNEL_ID = '1400363556557422712';
const CHANNEL_NAME_TEMPLATE = '﹙⭐﹚ㆍเครดิตส่งของㆍ{count}';

// ===== Counter persistence (ลดการ fetch ทั้งห้องทุกครั้ง) =====
const COUNTER_FILE = path.resolve('data/order_counter.json');
type CounterStore = Record<string, number>; // channelId -> count
function readCounter(): CounterStore {
  try { return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf-8')); } catch { return {}; }
}
function writeCounter(s: CounterStore) {
  fs.mkdirSync(path.dirname(COUNTER_FILE), { recursive: true });
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(s, null, 2), 'utf-8');
}

// ===== Utils =====
function isTextSendable(ch: any): ch is GuildTextBasedChannel {
  return !!ch && 'send' in ch && typeof ch.send === 'function';
}
function thNow() {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bangkok', hour12: false
  }).format(new Date());
}

// ครั้งแรกที่ยังไม่เคยมี counter: ไล่นับ embed ทั้งห้องก่อน 1 รอบ
async function countEmbedsInChannel(ch: GuildTextBasedChannel): Promise<number> {
  let lastId: string | undefined;
  let total = 0;

  while (true) {
    const options: { limit: number; before?: string } = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await ch.messages.fetch(options).catch(() => null);
    if (!messages || messages.size === 0) break;

    for (const m of messages.values()) {
      if (m.embeds?.length > 0) total += 1;
    }
    lastId = messages.last()?.id;
  }
  return total;
}

// ปรับชื่อห้องตาม template (ถ้าบอทมีสิทธิ์)
async function setChannelNameSafe(ch: GuildBasedChannel, count: number) {
  const newName = CHANNEL_NAME_TEMPLATE.replace('{count}', String(count));
  if (!('setName' in (ch as any))) return;
  try {
    const me = await (ch as any).guild.members.fetchMe();
    const canManage = me.permissions.has(PermissionFlagsBits.ManageChannels);
    if (!canManage) return;
    if ((ch as any).name !== newName) await (ch as any).setName(newName).catch(() => {});
  } catch {
    /* ignore */
  }
}

export const data = new SlashCommandBuilder()
  .setName('order')
  .setDescription('บันทึกการสั่งซื้อสินค้า')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption(option =>
    option.setName('user').setDescription('ผู้ซื้อสินค้า').setRequired(true))
  .addStringOption(option =>
    option.setName('name').setDescription('ชื่อสินค้า').setRequired(true))
  .addNumberOption(option =>
    option.setName('price').setDescription('ราคาทั้งหมด').setRequired(true))
  .addIntegerOption(option =>
    option.setName('quantity').setDescription('จำนวนสินค้า').setRequired(true))
  .addAttachmentOption(option =>
    option.setName('attachment').setDescription('แนบรูปภาพ (ถ้ามี)').setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
  // ✅ กัน timeout + ใช้ ephemeral
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild) {
    await interaction.editReply('❌ ใช้คำสั่งนี้ได้เฉพาะในกิลด์ครับ');
    return;
  }

  const user = interaction.options.getUser('user', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    await interaction.editReply('❌ ไม่พบสมาชิกในกิลด์นี้');
    return;
  }

  const name = interaction.options.getString('name', true).trim();
  const price = interaction.options.getNumber('price', true)!;
  const quantity = interaction.options.getInteger('quantity', true)!;
  const attachment = interaction.options.getAttachment('attachment') as Attachment | null;

  if (price <= 0 || quantity <= 0) {
    await interaction.editReply('❌ ราคาต่อชิ้นและจำนวนสินค้าต้องมากกว่า 0');
    return;
  }

  // ส่งข้อความปิดดีลลงช่องที่ใช้คำสั่ง (ถ้าสendได้)
  const descriptionText =
    `️ <a:dot:1400835527162204321> คุณ ${member.displayName} : ได้ชำระค่าสินค้า/บริการ เรียบร้อยแล้ว <a:truthcheck:1406176830385426532>`;
  if (isTextSendable(interaction.channel)) {
    await interaction.channel.send({ content: descriptionText }).catch(() => {});
  }

  // สร้าง embed รายละเอียดออเดอร์
  // ⛳ เปลี่ยนแล้ว: แสดง "ราคาต่อชิ้น" ไม่คูณจำนวน
  const embed = new EmbedBuilder()
    .setTitle('จัดส่งสินค้าสำเร็จ - ORDER SUCCESS')
    .setColor(0x00ff94)
    .setTimestamp(new Date())
    .setDescription(
      `||**ผู้ซื้อสินค้า :** <@${user.id}>||\n` +
      `<a:6564654:1303256134374789173> **ประเภทสินค้า :** ${name}\n` +
      `<a:6564654:1303256134374789173> **ราคาทั้งหมด :** \`${price.toLocaleString()} บาท\`\n` +
      `<a:6564654:1303256134374789173> **จำนวนสินค้า :** \`${quantity} ชิ้น\`\n` +
      `<a:6564654:1303256134374789173> **สถานะรายการ :** \`ลูกค้าได้รับสินค้าเรียบร้อย\`\n`
    )
    .setFooter({ text: '🟢 ทำรายการเรียบร้อย' });

  if (user.avatar) embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
  if (attachment) embed.setImage(attachment.url);

  // หา log channel (ลอง cache แล้วค่อย fetch เผื่อไม่ได้ cache)
  let logChannel = interaction.client.channels.cache.get(LOG_CHANNEL_ID) as GuildBasedChannel | undefined;
  if (!logChannel) {
    logChannel = await interaction.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null) as any;
  }

  if (!logChannel || !isTextSendable(logChannel) || !('messages' in (logChannel as any))) {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ เกิดข้อผิดพลาด!')
        .setDescription('ไม่พบห้อง log หรือส่งข้อความไม่ได้')]
    });
    return;
  }

  // ส่ง embed ไปยัง log
  await logChannel.send({ embeds: [embed] }).catch(async () => {
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ ส่งไปที่ห้อง log ไม่สำเร็จ')
        .setDescription('ตรวจสอบสิทธิ์บอทในห้อง log อีกครั้ง')]
    });
    return;
  });

  // ===== อัปเดตตัวนับและชื่อห้อง (แบบมี cache) =====
  const counters = readCounter();
  let count = counters[LOG_CHANNEL_ID];

  if (typeof count !== 'number') {
    // ครั้งแรก: นับทั้งห้องก่อน แล้วบันทึกจำนวนล่าสุด (รวมโพสต์ที่เพิ่งส่ง)
    count = await countEmbedsInChannel(logChannel as GuildTextBasedChannel);
  } else {
    // เคยมี counter แล้ว: +1
    count += 1;
  }
  counters[LOG_CHANNEL_ID] = count;
  writeCounter(counters);

  // ตั้งชื่อห้องตาม template (ถ้ามีสิทธิ์)
  await setChannelNameSafe(logChannel, count);

  // ✅ จบด้วย editReply
  await interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle('✅ สำเร็จ!')
      .setDescription(`บันทึกการสั่งซื้อของ **${member.displayName}** เรียบร้อยแล้ว`)
      .setColor(0x00ff94)]
  });
}
