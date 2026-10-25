import { useRef, useState } from 'react';
import {
  organizeConversations,
  type Conversation,
  type ConversationOrganization,
  type OrganizationAction,
} from '@livra/shared';
import { api, download } from './api';
import type { Notify } from './App';
import type { ConversationSession } from './useConversationRuns';
import {
  ConversationOrganizationList,
  type ConversationAction,
} from './ConversationOrganizationList';

type Props = {
  conversations: Conversation[];
  organization: ConversationOrganization;
  sessions: Record<string, ConversationSession>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onNew: (groupId: string | null) => void;
  onOrganize: (action: OrganizationAction) => Promise<ConversationOrganization>;
  onUpdate: (c: Conversation, patch: Partial<Conversation>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  notify: Notify;
};

// Keep Livra's async persistence and concurrent sessions behind Lumen's original UI.
export function ConversationList({
  conversations,
  organization,
  sessions,
  selectedId,
  onOpen,
  onNew,
  onOrganize,
  onUpdate,
  onDelete,
  notify,
}: Props) {
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const items = organizeConversations(
    conversations.map((c) =>
      sessions[c.id] && !organization.entries[c.id]?.title
        ? { ...c, title: sessions[c.id].conversation.title }
        : c,
    ),
    organization,
  );
  async function perform(action: () => Promise<void>) {
    if (lock.current) return false;
    lock.current = true;
    setPending(true);
    try {
      await action();
      return true;
    } catch (error) {
      notify((error as Error).message, 'error');
      return false;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function apply(action: ConversationAction) {
    return perform(async () => {
      const current = 'id' in action ? items.find((c) => c.id === action.id) : undefined;
      const patch = async (values: Partial<Conversation>) => {
        if (!current) throw Error('会话已不存在');
        await onUpdate(current, values);
      };
      switch (action.type) {
        case 'group-create': {
          const next = await onOrganize({
            type: 'create-group',
            name: action.group.name,
            color: action.group.color,
          });
          if (action.conversationId) {
            const created = next.groups.find(
              (g) => !organization.groups.some((old) => old.id === g.id),
            );
            if (!created) throw Error('分组创建失败，请重试');
            await onOrganize({ type: 'move', id: action.conversationId, groupId: created.id });
          }
          break;
        }
        case 'group-edit':
          await onOrganize({
            type: 'update-group',
            id: action.id,
            patch: { name: action.name, color: action.color },
          });
          break;
        case 'group-delete':
          await onOrganize({ type: 'delete-group', id: action.id });
          break;
        case 'group-collapse':
          await onOrganize(
            action.id
              ? { type: 'update-group', id: action.id, patch: { collapsed: action.collapsed } }
              : { type: 'collapse-ungrouped', collapsed: action.collapsed },
          );
          break;
        case 'collapse-all':
          await onOrganize(action);
          break;
        case 'group-reorder': {
          const peers = organization.groups.filter((g) => g.id !== action.id);
          const index = peers.findIndex((g) => g.id === action.targetId);
          if (index < 0) throw Error('分组已不存在');
          await onOrganize({
            type: 'reorder-group',
            id: action.id,
            beforeId: action.after ? peers[index + 1]?.id || null : action.targetId,
          });
          break;
        }
        case 'rename':
          await patch({ title: action.title });
          break;
        case 'color':
          await patch({ color: action.color || '' });
          break;
        case 'pin':
          await patch({ pinned: action.pinned });
          break;
        case 'archive':
          await patch({ archived: action.archived });
          break;
        case 'unread':
          await patch({ unread: action.unread });
          break;
        case 'delete':
          await onDelete(action.id);
          break;
        case 'move':
          await onOrganize({ type: 'move', id: action.id, groupId: action.groupId || null });
          break;
        case 'reorder': {
          const target = items.find((c) => c.id === action.targetId);
          if (!target) throw Error('目标会话已不存在');
          await onOrganize({
            type: 'move',
            id: action.id,
            groupId: target.groupId || null,
            targetId: target.id,
            placement: action.after ? 'after' : 'before',
          });
          break;
        }
      }
    });
  }
  return (
    <div className="conversation-sidebar" aria-busy={pending}>
      <ConversationOrganizationList
        conversations={items}
        groups={organization.groups}
        ungroupedCollapsed={organization.ungroupedCollapsed}
        activeId={selectedId || undefined}
        sessions={sessions}
        pending={pending}
        onSelect={onOpen}
        onNew={(id) => onNew(id || null)}
        onAction={apply}
        onExport={(id) => {
          void perform(async () => {
            const conversation =
              sessions[id]?.conversation || (await api<Conversation>('/conversations/' + id));
            const title = items.find((c) => c.id === id)?.title || conversation.title;
            download(
              title + '.md',
              conversation.messages
                .map(
                  (m) =>
                    `## ${m.role === 'user' ? '我' : m.role === 'assistant' ? '助手' : m.role}\n\n${m.content}`,
                )
                .join('\n\n'),
            );
          });
        }}
        notify={(message) => notify(message)}
      />
    </div>
  );
}
