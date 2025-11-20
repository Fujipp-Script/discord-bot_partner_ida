// src/events/interactionCreate.ts
import { Events } from 'discord.js';
import {
  parsePageFromEmbed, pageControls, listPageEmbed,
  loadData, saveData, toUserId, buildInfoEmbed,
  refreshTopupRanks,           // ✅ เพิ่ม
} from '@/utils/topupStore.js';    // ✅ ตัด .js ออก

export const name = Events.InteractionCreate;

export async function execute(i: any) {
  // ====== Modal: topup update ======
  if (i.isModalSubmit() && i.customId === 'modal_topup_update') {
    const uid = i.fields.getTextInputValue('user_id');
    const amountStr = i.fields.getTextInputValue('amount');
    const countStr  = i.fields.getTextInputValue('count');
    const userId = toUserId(uid);
    if (!userId) return i.reply({ ephemeral: true, content: '❌ user ไม่ถูกต้อง' });

    const data = await loadData(i.guildId!);
    if (!data[userId]) data[userId] = { amount: 0, count: 0 };
    if (amountStr) data[userId].amount = Math.max(0, Number(amountStr) || 0);
    if (countStr)  data[userId].count  = Math.max(0, Number(countStr) || 0);
    await saveData(i.guildId!, data);

    // ✅ อัปเดตอันดับ/ยศ TOP1/TOP5 ทันทีหลังแก้ยอด
    await refreshTopupRanks(i.guild ?? await i.client.guilds.fetch(i.guildId!));

    await i.reply({
      ephemeral: true,
      embeds: [buildInfoEmbed('✅ อัปเดตสำเร็จ', `<@${userId}> ⇒ \`${data[userId].amount}\` บาท • \`${data[userId].count}\` ครั้ง`)]
    });
    return;
  }

  // ====== Buttons: topup list pagination ======
  if (i.isButton() && (i.customId === 'topup_list_prev' || i.customId === 'topup_list_next')) {
    const msg = i.message;
    const { page, pages } = parsePageFromEmbed(msg);
    const next = i.customId.endsWith('prev') ? Math.max(1, page-1) : Math.min(pages, page+1);

    // (ถ้าอยากให้กด list แล้วซ่อมยศทุกครั้ง ให้ uncomment บรรทัดนี้)
    // await refreshTopupRanks(i.guild ?? await i.client.guilds.fetch(i.guildId!));

    const { embed } = await listPageEmbed(i.guildId!, next, 20);
    await i.update({ embeds: [embed], components: [pageControls(next, pages)] });
    return;
  }
}
