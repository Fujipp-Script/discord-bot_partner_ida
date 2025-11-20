// src/commands/topup.ts
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { ensurePermissions } from '@/utils/permissions.js';
import {
  addAmount,
  loadData, saveData, ensureUser,
  buildCardEmbed, buildInfoEmbed,
  listPageEmbed, pageControls,
  totalEmbed, shouldUpgrade,
  giveFirstRoleIfNeed, giveUpgradeIfNeed,
  refreshTopupRanks, sortEntries
} from '@/utils/topupStore.js';

function makeUpdateModal(userId: string) {
  const modal = new ModalBuilder()
    .setCustomId('modal_topup_update')
    .setTitle('ตั้งยอด/จำนวนครั้งใหม่');

  const fUser = new TextInputBuilder()
    .setCustomId('user_id')
    .setLabel('User ID หรือ Mention')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(userId);

  const fAmount = new TextInputBuilder()
    .setCustomId('amount')
    .setLabel('ตั้งยอดรวม (บาท) — เว้นว่างเพื่อไม่เปลี่ยน')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const fCount = new TextInputBuilder()
    .setCustomId('count')
    .setLabel('ตั้งจำนวนครั้ง — เว้นว่างเพื่อไม่เปลี่ยน')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(fUser),
    new ActionRowBuilder<TextInputBuilder>().addComponents(fAmount),
    new ActionRowBuilder<TextInputBuilder>().addComponents(fCount),
  );
  return modal;
}

export default {
  data: new SlashCommandBuilder()
    .setName('topup')
    .setDescription('จัดการระบบยอดการใช้เงิน')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s
      .setName('add')
      .setDescription('เพิ่มยอดการใช้เงินให้ผู้ใช้')
      .addUserOption(o => o.setName('user').setDescription('ผู้ใช้').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('จำนวนเงิน (บาท)').setRequired(true)))
    .addSubcommand(s => s
      .setName('update')
      .setDescription('ตั้งยอด/จำนวนครั้งใหม่ (เปิด Modal)')
      .addUserOption(o => o.setName('user').setDescription('ผู้ใช้').setRequired(true)))
    .addSubcommand(s => s
      .setName('delete')
      .setDescription('ลบข้อมูลการใช้เงินของผู้ใช้')
      .addUserOption(o => o.setName('user').setDescription('ผู้ใช้').setRequired(true)))
    .addSubcommand(s => s
      .setName('check')
      .setDescription('ตรวจสอบยอดการใช้เงิน')
      .addUserOption(o => o.setName('user').setDescription('ผู้ใช้ (เว้นว่าง=ตัวเอง)').setRequired(false)))
    .addSubcommand(s => s
      .setName('list')
      .setDescription('แสดงอันดับการใช้เงิน (หน้า 20 คน พร้อมปุ่มเปลี่ยนหน้า)'))
    .addSubcommand(s => s
      .setName('total')
      .setDescription('สรุปยอดรวมทั้งหมด (ยอดเงิน + จำนวนครั้ง)'))
    .addSubcommand(s => s
      .setName('rank')
      .setDescription('รีเฟรชยศ TOP1/TOP5 ตามอันดับปัจจุบัน')),

  cooldown: 3,

  async checkPermissions(i: ChatInputCommandInteraction) {
    ensurePermissions(i.member, ['Administrator']);
  },

  async execute(i: ChatInputCommandInteraction) {
    const sub = i.options.getSubcommand(true);

    if (sub === 'add') {
      const user = i.options.getUser('user', true);
      const amount = i.options.getInteger('amount', true);
      if (amount <= 0) return i.reply({ ephemeral: true, content: '❌ ต้องใส่จำนวนมากกว่า 0' });

      await i.deferReply({ ephemeral: true });

      const { entry } = await addAmount(i.guildId!, user.id, amount);

      const member = await i.guild!.members.fetch(user.id).catch(() => null);
      if (member) {
        // แจกยศแรกเริ่มเสมอถ้ายังไม่มี
        await giveFirstRoleIfNeed(member).catch(() => {});
        // อัปเกรดถ้าถึง threshold
        if (shouldUpgrade(entry)) await giveUpgradeIfNeed(member).catch(() => {});
      }

      // อัปเดต Top1/Top5 ทุกครั้งหลังยอดเปลี่ยน
      await refreshTopupRanks(i.guild!);

      // โพสต์บัตรสมาชิก
      const embed = await buildCardEmbed(i, user.id, amount, entry.amount, entry.count, entry.count === 1);
      if (i.channel && 'send' in i.channel) {
        // @ts-ignore
        await i.channel.send({
          content: `<a:kawaii_bow:1393983463320719481>：||<@${user.id}>||`,
          embeds: [embed],
          allowedMentions: { parse: [] }
        }).catch(()=>{});
      }

      return i.editReply('✅ อัปเดตบัตรสมาชิกแล้ว');
    }

    if (sub === 'update') {
      const user = i.options.getUser('user', true);
      return i.showModal(makeUpdateModal(user.id));
    }

    if (sub === 'delete') {
      const user = i.options.getUser('user', true);
      const data = await loadData(i.guildId!);
      if (data[user.id]) {
        delete data[user.id];
        await saveData(i.guildId!, data);
        await refreshTopupRanks(i.guild!);
        return i.reply({
          ephemeral: true,
          embeds: [buildInfoEmbed('🗑️ ลบยอดการใช้เงิน', `ลบข้อมูลของ <@${user.id}> เรียบร้อย`)]
        });
      }
      return i.reply({ ephemeral: true, content: '❌ ไม่พบข้อมูลของผู้ใช้นี้' });
    }

    if (sub === 'check') {
      const user = i.options.getUser('user') ?? i.user;
      const data = await loadData(i.guildId!);
      const entry = ensureUser(data, user.id);
      return i.reply({
        ephemeral: true,
        embeds: [buildInfoEmbed('🔎 ตรวจสอบยอดการใช้เงิน', `<@${user.id}> มียอดสะสม \`${entry.amount}\` บาท • \`${entry.count}\` ครั้ง`)]
      });
    }

    if (sub === 'list') {
      await refreshTopupRanks(i.guild!);
      const { embed, page, pages } = await listPageEmbed(i.guildId!, 1, 20);
      return i.reply({
        embeds: [embed],
        components: [pageControls(page, pages)],
        ephemeral: false
      });
    }

    if (sub === 'total') {
      const embed = await totalEmbed(i.guildId!);
      return i.reply({ ephemeral: true, embeds: [embed] });
    }

    if (sub === 'rank') {
      // รีเฟรชยศ แล้วตอบสรุปอันดับปัจจุบัน
      await i.deferReply({ ephemeral: true });

      const data = await loadData(i.guildId!);
      const sorted = sortEntries(data); // เรียงตาม amount จากมากไปน้อย (หรือใช้ refreshTopupRanks’ logic ก็ได้)
      await refreshTopupRanks(i.guild!);

      const top1 = sorted[0]?.[0];
      const top5 = sorted.slice(0, 5).map(([uid]) => uid);

      const lines: string[] = [];
      if (top1) {
        lines.push(`🏆 **TOP 1**: <@${top1}>`);
      } else {
        lines.push('🏆 **TOP 1**: —');
      }
      if (top5.length > 0) {
        const rest = top5.filter(uid => uid !== top1);
        lines.push(`⭐ **TOP 5**: ${[top1, ...rest].filter(Boolean).map(uid => `<@${uid}>`).join(', ')}`);
      } else {
        lines.push('⭐ **TOP 5**: —');
      }

      const embed = new EmbedBuilder()
        .setColor(0xE46DAF)
        .setTitle('🔄 รีเฟรชยศ TOP1 / TOP5 แล้ว')
        .setDescription(lines.join('\n'))
        .setTimestamp(new Date());

      return i.editReply({ embeds: [embed] });
    }
  }
};
