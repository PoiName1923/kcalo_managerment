import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export function authorized(header: string | string[] | undefined, secret: string): boolean {
  if (typeof header !== 'string' || !secret) return false;
  const a = Buffer.from(header), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const updateSchema = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: z.object({
    message_id: z.number().int().positive(), date: z.number().int(),
    chat: z.object({ id: z.number().int().safe(), type: z.literal('private') }),
    from: z.object({ id: z.number().int().safe() }),
    text: z.string().max(4096).optional(), caption: z.string().max(1024).optional(),
    photo: z.array(z.object({ file_id: z.string().max(512), width: z.number(), height: z.number() })).max(10).optional(),
  }),
});
export function acceptUpdate(input: unknown, allowlist: string[]) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return null;
  const { update_id, message: m } = parsed.data;
  const age = Date.now() / 1000 - m.date;
  if (age > 30 * 86400 || age < -300 || m.chat.id !== m.from.id) return null;
  if (allowlist.length && !allowlist.includes(String(m.from.id))) return null;
  const photo = m.photo?.reduce<(NonNullable<typeof m.photo>)[number] | undefined>((best, p) =>
    !best || p.width * p.height > best.width * best.height ? p : best, undefined);
  return { update_id, chat_id: m.chat.id, message_id: m.message_id,
    payload: { ...(photo ? { file_id: photo.file_id } : {}), text: m.text ?? '', caption: m.caption ?? '' } };
}
