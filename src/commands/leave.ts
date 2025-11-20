import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction
} from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { disableKeep } from '@/features/voice/voiceKeeper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('ให้บอทออกจากห้องเสียงและปิดโหมดอยู่ห้อง 24/7')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(i: ChatInputCommandInteraction) {
    if (!i.guild) return i.reply({ ephemeral: true, content: 'ใช้ในเซิร์ฟเวอร์เท่านั้น' });

    const conn = getVoiceConnection(i.guild.id);
    try { conn?.destroy(); } catch {}

    // ✅ ปิดโหมดอยู่ห้อง 24/7 + หยุดลูป rejoin
    disableKeep(i.guild.id);

    await i.reply({ ephemeral: true, content: '👋 ออกจากห้องเสียงแล้ว และปิดโหมดอยู่ห้อง 24/7' });
  }
};
