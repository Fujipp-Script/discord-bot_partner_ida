import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction
} from 'discord.js';
import { joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import { enableKeep } from '@/features/voice/voiceKeeper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('ให้บอทเข้าอยู่ในห้องเสียง (ถ้าไม่ใส่ channel จะใช้ห้องที่คุณอยู่) และจะอยู่ตลอดเวลา')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName('channel')
       .setDescription('ห้องเสียง (ว่าง = ใช้ห้องที่คุณอยู่)')
       .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
       .setRequired(false)
    ),

  async execute(i: ChatInputCommandInteraction) {
    if (!i.guild) return i.reply({ ephemeral: true, content: 'ใช้ในเซิร์ฟเวอร์เท่านั้น' });

    const ch = i.options.getChannel('channel');
    const memberVoiceId = (i.member as any)?.voice?.channelId as string | undefined;
    const targetChannelId = ch?.id ?? memberVoiceId;

    if (!targetChannelId) {
      return i.reply({ ephemeral: true, content: '❌ โปรดอยู่ในห้องเสียง หรือระบุห้องเสียงที่จะให้บอทเข้า' });
    }

    // ปิด connection เดิมก่อน (กันซ้อน)
    try { getVoiceConnection(i.guild.id)?.destroy(); } catch {}

    try {
      joinVoiceChannel({
        channelId: targetChannelId,
        guildId: i.guild.id,
        adapterCreator: i.guild.voiceAdapterCreator as any,
        selfDeaf: true,
        selfMute: true,
      });

      // ✅ บันทึกค่า + เปิดโหมดอยู่ห้องตลอดเวลา (rejoin อัตโนมัติ + ลูป 30 นาที)
      enableKeep(i.guild.id, targetChannelId);

      await i.reply({
        ephemeral: true,
        content: `✅ เข้า <#${targetChannelId}> แล้ว และจะอยู่ 24/7 (ถ้าหลุดจะกลับเข้าห้องเดิมอัตโนมัติ)`
      });
    } catch (e: any) {
      await i.reply({ ephemeral: true, content: `❌ เข้าไม่สำเร็จ: ${e?.message || e}` });
    }
  }
};
