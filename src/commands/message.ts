// src/commands/message.ts
import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type ModalActionRowComponentBuilder,
  type Attachment,
  type GuildBasedChannel,
  type Client,
} from 'discord.js';

// ====== Pending state (เก็บบน client ไม่ต้องสร้างไฟล์ใหม่) ======
export type PendingSend = {
  userId: string;
  guildId: string | null;
  channelId: string;
  files: Array<{ url: string; name?: string }>;
};
export const PENDING_KEY = Symbol.for('app.pendingSendMap');

export function getPendingMap(client: Client): Map<string, PendingSend> {
  const anyClient = client as any;
  if (!anyClient[PENDING_KEY]) anyClient[PENDING_KEY] = new Map<string, PendingSend>();
  return anyClient[PENDING_KEY] as Map<string, PendingSend>;
}

// ส่งได้ไหม
function isTextSendable(ch: GuildBasedChannel | null | undefined): ch is GuildTextBasedChannel {
  return !!ch && 'send' in ch && typeof (ch as any).send === 'function';
}

/**
 * /message
 *  - send channel:<channel> [file]: เปิด Modal ให้กรอกเนื้อหา แล้วส่งไปยังห้องปลายทาง (แนบไฟล์ได้ 1 ไฟล์)
 *  - sendfile channel:<channel> file:<file> [caption]: ส่งไฟล์ทันที (มี caption ได้)
 *  - edit messageid:<id> (ในห้องปัจจุบัน, แก้ได้เฉพาะข้อความที่บอทส่ง)
 */
export const data = new SlashCommandBuilder()
  .setName('message')
  .setDescription('ส่งหรือแก้ไขข้อความผ่าน Modal / แนบไฟล์')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)

  // --- send ---
  .addSubcommand((sub) =>
    sub
      .setName('send')
      .setDescription('ส่งข้อความ (ผ่าน Modal) ไปยังห้องที่กำหนด, แนบไฟล์ได้')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('ห้องที่จะส่งข้อความ')
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread
          )
          .setRequired(true),
      )
      .addAttachmentOption((opt) =>
        opt
          .setName('file')
          .setDescription('ไฟล์แนบ (ไม่บังคับ)')
          .setRequired(false),
      ),
  )

  // --- sendfile ---
  .addSubcommand((sub) =>
    sub
      .setName('sendfile')
      .setDescription('ส่งไฟล์อย่างเดียวไปยังห้องที่กำหนด (มี caption ได้)')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('ห้องที่จะส่งไฟล์')
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread
          )
          .setRequired(true),
      )
      .addAttachmentOption((opt) =>
        opt
          .setName('file')
          .setDescription('ไฟล์แนบ (จำเป็น)')
          .setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('caption')
          .setDescription('ข้อความประกอบไฟล์ (ไม่บังคับ)')
          .setRequired(false),
      ),
  )

  // --- edit ---
  .addSubcommand((sub) =>
    sub
      .setName('edit')
      .setDescription('แก้ไขข้อความที่มีอยู่ (ในห้องปัจจุบัน)')
      .addStringOption((opt) =>
        opt
          .setName('messageid')
          .setDescription('Message ID ของข้อความที่จะถูกแก้ไข (ต้องเป็นข้อความของบอท)')
          .setRequired(true),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand(true);

  // ===========================
  // /message send
  // ===========================
  if (sub === 'send') {
    const channel = interaction.options.getChannel('channel', true) as GuildBasedChannel;
    const file = interaction.options.getAttachment('file', false) as Attachment | null;

    if (!interaction.guild) {
      await interaction.reply({ content: '❌ ใช้คำสั่งนี้ได้เฉพาะในกิลด์ครับ', ephemeral: true });
      return;
    }

    // เก็บ state ชั่วคราวบน client
    const token = interaction.id;
    const map = getPendingMap(interaction.client);
    map.set(token, {
      userId: interaction.user.id,
      guildId: interaction.guildId ?? null,
      channelId: channel.id,
      files: file ? [{ url: file.url, name: file.name }] : [],
    });

    // เปิด Modal ให้กรอกข้อความใหม่
    const modal = new ModalBuilder()
      .setCustomId(`message_send:${token}`)
      .setTitle('พิมพ์ข้อความที่จะส่ง');

    const input = new TextInputBuilder()
      .setCustomId('message_content')
      .setLabel('ข้อความที่จะส่ง (≤ 2000 ตัวอักษร)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const row =
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
    modal.addComponents(row);

    await interaction.showModal(modal);
    return;
  }

  // ===========================
  // /message sendfile
  // ===========================
  if (sub === 'sendfile') {
    const channel = interaction.options.getChannel('channel', true) as GuildBasedChannel;
    const file = interaction.options.getAttachment('file', true) as Attachment;
    const caption = interaction.options.getString('caption') ?? undefined;

    if (!isTextSendable(channel)) {
      await interaction.reply({ content: '❌ ห้องนี้ไม่รองรับการส่งข้อความ/ไฟล์โดยตรง', ephemeral: true });
      return;
    }

    try {
      const sent = await channel.send({
        content: caption,
        files: [{ attachment: file.url, name: file.name }],
      });
      await interaction.reply({ content: `✅ ส่งไฟล์เรียบร้อย: ${sent.url}`, ephemeral: true });
    } catch {
      await interaction.reply({
        content: '❌ ส่งไฟล์ไม่สำเร็จ (อาจติดสิทธิ์หรือขนาดไฟล์เกิน)',
        ephemeral: true,
      });
    }
    return;
  }

  // ===========================
  // /message edit
  // ===========================
  if (sub === 'edit') {
    const messageId = interaction.options.getString('messageid', true);

    const ch = interaction.channel;
    if (!ch || !ch.isTextBased()) {
      await interaction.reply({ content: '❌ คำสั่งนี้ใช้ได้เฉพาะในห้องข้อความครับ', ephemeral: true });
      return;
    }

    try {
      const msg = await (ch as GuildTextBasedChannel).messages.fetch(messageId);

      // เพื่อความปลอดภัย: แก้ได้เฉพาะข้อความที่ "บอท" เป็นคนส่ง
      if (msg.author?.id !== interaction.client.user?.id) {
        await interaction.reply({ content: '❌ แก้ได้เฉพาะข้อความที่บอทเป็นคนส่งเท่านั้น', ephemeral: true });
        return;
      }

      const current = (msg.content ?? '').slice(0, 2000);

      const modal = new ModalBuilder()
        .setCustomId(`message_edit:${messageId}`)
        .setTitle('แก้ไขข้อความ');

      const input = new TextInputBuilder()
        .setCustomId('new_content')
        .setLabel('ข้อความใหม่ (≤ 2000 ตัวอักษร)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setValue(current);

      const row =
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
    } catch {
      await interaction.reply({ content: '❌ ไม่พบข้อความนั้นในห้องนี้', ephemeral: true });
    }
    return;
  }
}
