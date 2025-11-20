// src/utils/permissions.ts
import type { GuildMember } from 'discord.js';

export function ensurePermissions(member: any, required: Array<'Administrator'>) {
  const m = member as GuildMember | null | undefined;
  if (!m) throw new Error('⛔ ใช้ได้เฉพาะในกิลด์');
  const hasAdmin = m.permissions?.has('Administrator');
  if (required.includes('Administrator') && !hasAdmin) {
    throw new Error('⛔ ต้องมีสิทธิ์ Administrator');
  }
}
