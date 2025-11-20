// src/events/interactionCreate.message.ts
import { Events, ChannelType, type GuildTextBasedChannel, type ModalSubmitInteraction } from 'discord.js';
import { getPendingMap, PENDING_KEY } from '@/commands/message.js';

export const name = Events.InteractionCreate;

export async function execute(i: any) {
  if (!i.isModalSubmit()) return;

  // ========= Modal: message_send:<token> =========
  if (i.customId.startsWith('message_send:')) {
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
      // ดึง channel แล้วตรวจว่าเป็น text-based
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

      // เคลียร์ state
      map.delete(token);

      await i.reply({ ephemeral: true, content: `✅ ส่งข้อความเรียบร้อย: ${sent.url}` }).catch(()=>{});
    } catch {
      await i.reply({ ephemeral: true, content: '❌ เกิดข้อผิดพลาดระหว่างส่งข้อความ' }).catch(()=>{});
    }
    return;
  }

  // ========= Modal: message_edit:<messageId> =========
  if (i.customId.startsWith('message_edit:')) {
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

      // ป้องกัน: แก้ได้เฉพาะข้อความที่บอทส่ง
      if (msg.author?.id !== i.client.user?.id) {
        await i.reply({ ephemeral: true, content: '❌ แก้ได้เฉพาะข้อความที่บอทเป็นคนส่งเท่านั้น' }).catch(()=>{});
        return;
      }

      await msg.edit({ content: newContent });
      await i.reply({ ephemeral: true, content: '✅ แก้ไขข้อความเรียบร้อย' }).catch(()=>{});
    } catch {
      await i.reply({ ephemeral: true, content: '❌ ไม่พบข้อความที่จะแก้ไขในห้องนี้' }).catch(()=>{});
    }
    return;
  }
}
