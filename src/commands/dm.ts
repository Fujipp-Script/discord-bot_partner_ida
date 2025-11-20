// src/commands/dm.ts
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  MessageFlags,
  User,
  Events,
} from "discord.js";

// helper: ตัดสตริงไม่ให้เกินความยาวที่กำหนด
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default {
  data: new SlashCommandBuilder()
    .setName("dm")
    .setDescription("ส่ง DM ถึงผู้ใช้ด้วย Modal (เลือกผู้ใช้ได้)")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("เลือกผู้ใช้ที่จะ DM")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(i: ChatInputCommandInteraction) {
    const target: User = i.options.getUser("user", true);

    // กันเคส DM บอท (ถ้าจะอนุโลมก็ลบบล็อกนี้ได้)
    if (target.bot) {
      await i
        .reply({ flags: MessageFlags.Ephemeral, content: "⚠️ เลือกเป็นบอท ไม่สามารถส่ง DM ได้" })
        .catch(() => {});
      return;
    }

    // ===== สร้าง Modal แบบปลอดภัยเรื่องความยาว =====
    const input = new TextInputBuilder()
      .setCustomId("dm_content")
      .setLabel("พิมพ์ข้อความที่จะส่ง") // ≤ 45 ตัวอักษรตามสเปค
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setPlaceholder(trunc(`ถึง ${target.tag} — สูงสุด 2000 ตัวอักษร`, 100));

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    const customId = `dm_send:${target.id}:${i.id}`; // ผูกกับ interaction นี้ กันชนกัน
    const modal = new ModalBuilder()
      .setCustomId(customId)
      .setTitle(trunc(`DM → ${target.username}`, 45))
      .addComponents(row);

    // แสดง Modal (กันพลาด)
    try {
      await i.showModal(modal);
    } catch (err) {
      console.error("showModal failed:", err);
      await i
        .reply({
          flags: MessageFlags.Ephemeral,
          content: "❌ เปิดหน้ากรอกข้อความไม่สำเร็จ กรุณาลองใหม่",
        })
        .catch(() => {});
      return;
    }

    // ===== รอผล ModalSubmit เฉพาะครั้งนี้ =====
    const onModal = async (m: Interaction) => {
      if (!m.isModalSubmit()) return;
      if (m.user.id !== i.user.id) return; // คนกดต้องเป็นคนสั่ง
      if (m.customId !== customId) return; // ต้องตรงกับ modal นี้

      await m.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

      try {
        const content = (m.fields.getTextInputValue("dm_content") || "").slice(0, 2000);
        if (!content) {
          await m.editReply({ content: "❌ ต้องกรอกข้อความก่อนส่ง" });
          return;
        }

        const user = await i.client.users.fetch(target.id).catch(() => null);
        if (!user) {
          await m.editReply({ content: "❌ ไม่พบผู้ใช้ปลายทาง" });
          return;
        }

        try {
          await user.send({ content });
        } catch {
          await m.editReply({
            content: "⚠️ ส่ง DM ไม่ได้ — ผู้รับอาจปิด DM หรือบอทถูกบล็อก",
          });
          return;
        }

        await m.editReply({ content: `✅ ส่ง DM ถึง <@${user.id}> (${user.tag}) เรียบร้อย` });
      } finally {
        i.client.off(Events.InteractionCreate, onModal); // cleanup
        clearTimeout(timer);
      }
    };

    const timer = setTimeout(() => {
      i.client.off(Events.InteractionCreate, onModal);
    }, 2 * 60 * 1000);

    i.client.on(Events.InteractionCreate, onModal);
  },
};
