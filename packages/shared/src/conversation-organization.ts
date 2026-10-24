import { z } from 'zod';
import type { Conversation } from './index';

export const conversationColors = [
  { value: '#35d99e', name: '薄荷' },
  { value: '#67e8f9', name: '青空' },
  { value: '#7cc7f7', name: '星蓝' },
  { value: '#b4a3f7', name: '鸢尾' },
  { value: '#f5b84f', name: '琥珀' },
  { value: '#fb7185', name: '珊瑚' },
  { value: '#f472b6', name: '蔷薇' },
  { value: '#a3e635', name: '新芽' },
] as const;
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const conversationGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(24),
  color,
  collapsed: z.boolean().default(false),
});
export type ConversationGroup = z.infer<typeof conversationGroupSchema>;
export const conversationMetaSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  groupId: z.string().uuid().nullable().optional(),
  color: z.union([color, z.literal('')]).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  unread: z.boolean().optional(),
});
export const conversationOrganizationSchema = z
  .object({
    revision: z.number().int().nonnegative().default(0),
    groups: z.array(conversationGroupSchema).max(100).default([]),
    ungroupedCollapsed: z.boolean().default(false),
    entries: z.record(z.string().uuid(), conversationMetaSchema).default({}),
    order: z.array(z.string().uuid()).max(1000).default([]),
  })
  .superRefine((value, ctx) => {
    const groups = new Set(value.groups.map((g) => g.id));
    if (groups.size !== value.groups.length || new Set(value.order).size !== value.order.length)
      ctx.addIssue({ code: 'custom', message: '分组或会话顺序中存在重复标识' });
    if (Object.keys(value.entries).length > 1000)
      ctx.addIssue({ code: 'custom', message: '会话标记数量超过上限' });
    if (Object.values(value.entries).some((m) => m.groupId && !groups.has(m.groupId)))
      ctx.addIssue({ code: 'custom', message: '会话引用了不存在的分组' });
  });
export type ConversationOrganization = z.infer<typeof conversationOrganizationSchema>;
export const organizationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create-group'), name: conversationGroupSchema.shape.name, color }),
  z.object({
    type: z.literal('update-group'),
    id: z.string().uuid(),
    patch: conversationGroupSchema.pick({ name: true, color: true, collapsed: true }).partial(),
  }),
  z.object({ type: z.literal('delete-group'), id: z.string().uuid() }),
  z.object({
    type: z.literal('reorder-group'),
    id: z.string().uuid(),
    beforeId: z.string().uuid().nullable(),
  }),
  z.object({ type: z.literal('collapse-all'), collapsed: z.boolean() }),
  z.object({ type: z.literal('collapse-ungrouped'), collapsed: z.boolean() }),
  z.object({
    type: z.literal('move'),
    id: z.string().uuid(),
    groupId: z.string().uuid().nullable(),
    targetId: z.string().uuid().optional(),
    placement: z.enum(['before', 'after']).default('before'),
  }),
]);
export type OrganizationAction = z.input<typeof organizationActionSchema>;

export function organizeConversations(
  conversations: Conversation[],
  organization: ConversationOrganization,
): Conversation[] {
  const positions = new Map(organization.order.map((id, i) => [id, i]));
  return conversations
    .map((c) => ({ ...c, ...organization.entries[c.id] }))
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) ||
        b.updated - a.updated ||
        a.id.localeCompare(b.id),
    );
}
