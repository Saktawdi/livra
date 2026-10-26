import {
  conversationOrganizationSchema,
  organizationActionSchema,
  organizeConversations,
  type ConversationOrganization,
  type OrganizationAction,
  type Settings,
  type Conversation,
  type Artifact,
  type Memory,
} from '@livra/shared';
const randomUUID = () => crypto.randomUUID();
export abstract class RuntimeStore {
  readonly local: boolean = false;
  abstract settings(workspace: string): Settings;
  abstract saveSettings(workspace: string, settings: Settings): void;
  abstract list<T>(workspace: string, kind: string): T[];
  abstract get<T>(workspace: string, kind: string, id: string): T | undefined;
  abstract put<T extends { id: string }>(workspace: string, kind: string, record: T): T;
  abstract delete(workspace: string, kind: string, id: string): void;
  conversations(workspace: string) {
    return organizeConversations(
      this.list<Conversation>(workspace, 'conversation'),
      this.organization(workspace),
    );
  }
  conversation(workspace: string, id: string) {
    const c = this.get<Conversation>(workspace, 'conversation', id);
    return c ? { ...c, ...this.organization(workspace).entries[id] } : undefined;
  }
  organization(workspace: string): ConversationOrganization {
    return conversationOrganizationSchema.parse(
      this.get(workspace, 'conversation-organization', 'sidebar') || {},
    );
  }
  saveOrganization(workspace: string, value: ConversationOrganization) {
    const next = conversationOrganizationSchema.parse(value);
    next.revision = this.organization(workspace).revision + 1;
    this.put(workspace, 'conversation-organization', { ...next, id: 'sidebar' });
    return next;
  }
  organize(workspace: string, input: OrganizationAction) {
    const action = organizationActionSchema.parse(input);
    const next = this.organization(workspace);
    const missing = (message: string): never => {
      throw Object.assign(Error(message), { statusCode: 404 });
    };
    if (action.type === 'create-group') {
      if (next.groups.length >= 100)
        throw Object.assign(Error('最多创建 100 个分组'), { statusCode: 400 });
      next.groups.push({
        id: randomUUID(),
        name: action.name,
        color: action.color,
        collapsed: false,
      });
    } else if (action.type === 'collapse-all') {
      next.ungroupedCollapsed = action.collapsed;
      next.groups.forEach((g) => {
        g.collapsed = action.collapsed;
      });
    } else if (action.type === 'collapse-ungrouped') {
      next.ungroupedCollapsed = action.collapsed;
    } else if (action.type === 'move') {
      const c = this.conversation(workspace, action.id) || missing('对话不存在');
      if (action.groupId && !next.groups.some((g) => g.id === action.groupId))
        missing('分组不存在');
      const target = action.targetId
        ? this.conversation(workspace, action.targetId) || missing('目标对话不存在')
        : undefined;
      if (
        target &&
        ((target.groupId || null) !== action.groupId || !!target.archived !== !!c.archived)
      )
        throw Object.assign(Error('目标对话不在当前分区'), { statusCode: 400 });
      if (target?.id === c.id) return next;
      next.entries[c.id] = {
        ...next.entries[c.id],
        groupId: action.groupId,
        ...(target ? { pinned: !!target.pinned } : {}),
      };
      const order = this.conversations(workspace)
        .map((c) => c.id)
        .filter((id) => id !== c.id);
      const index = target
        ? order.indexOf(target.id) + Number(action.placement === 'after')
        : order.length;
      order.splice(index, 0, c.id);
      next.order = order;
      if (action.groupId) next.groups.find((g) => g.id === action.groupId)!.collapsed = false;
      else next.ungroupedCollapsed = false;
    } else {
      const group = next.groups.find((g) => g.id === action.id) || missing('分组不存在');
      if (action.type === 'update-group') Object.assign(group, action.patch);
      if (action.type === 'delete-group') {
        next.groups = next.groups.filter((g) => g.id !== group.id);
        for (const entry of Object.values(next.entries))
          if (entry.groupId === group.id) entry.groupId = null;
      }
      if (action.type === 'reorder-group') {
        if (action.beforeId === group.id) return next;
        if (action.beforeId && !next.groups.some((g) => g.id === action.beforeId))
          missing('目标分组不存在');
        next.groups = next.groups.filter((g) => g.id !== group.id);
        const index = action.beforeId
          ? next.groups.findIndex((g) => g.id === action.beforeId)
          : next.groups.length;
        next.groups.splice(index, 0, group);
      }
    }
    return this.saveOrganization(workspace, next);
  }
  artifacts(workspace: string) {
    return this.list<Artifact>(workspace, 'artifact');
  }
  memories(workspace: string, personaId?: string) {
    return this.list<Memory>(workspace, 'memory').filter(
      (m) => !personaId || m.personaId === personaId,
    );
  }
}
