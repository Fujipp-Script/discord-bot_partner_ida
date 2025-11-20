// src/commands/credit.ts
import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  type ChatInputCommandInteraction, type TextChannel
} from 'discord.js';
import { setChannelId } from '@/features/credit/configStore.js';

const data = new SlashCommandBuilder()
  .setName('credit')
  .setDescription('ตั้งค่าห้องสำหรับระบบนับรีวิว + ตอบสุ่ม + รีเนม')
  .addSubcommand(sc =>
    sc.setName('setup')
      .setDescription('กำหนดห้องที่จะให้ระบบทำงาน')
      .addStringOption(o =>
        o.setName('channelid')
          .setDescription('ID ของ Text Channel')
          .setRequired(true)
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function execute(i: ChatInputCommandInteraction) {
  if (!i.isChatInputCommand() || i.commandName !== 'credit' || i.options.getSubcommand(true) !== 'setup') return;
  if (!i.guild) return i.reply({ content: 'ใช้ในเซิร์ฟเวอร์เท่านั้นครับ', ephemeral: true });

  await i.deferReply({ ephemeral: true });

  const channelId = i.options.getString('channelid', true);
  const ch = await i.guild.channels.fetch(channelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildText) {
    return i.editReply('ต้องเป็น **Text Channel** ในกิลด์นี้ครับ');
  }

  // แนะนำสิทธิ์ (ไม่บังคับ)
  const me = await i.guild.members.fetchMe();
  const perms = (ch as TextChannel).permissionsFor(me);
  if (!perms?.has('SendMessages') || !perms?.has('ReadMessageHistory') || !perms?.has('ManageChannels')) {
    await i.followUp({
      ephemeral: true,
      content: '⚠️ โปรดให้สิทธิ์บอทในห้องนั้น: **Send Messages**, **Read Message History**, **Manage Channels**'
    }).catch(() => {});
  }

  await setChannelId(i.guild.id, channelId);
  await i.editReply(`✅ ตั้งค่าห้องเรียบร้อย: <#${channelId}>`);
}

export default { data, execute };
