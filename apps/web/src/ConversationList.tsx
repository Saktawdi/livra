import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
  Mail,
  MailOpen,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  conversationColors,
  organizeConversations,
  type Conversation,
  type ConversationGroup,
  type ConversationOrganization,
  type OrganizationAction,
} from '@livra/shared';
import type { ConversationSession } from './useConversationRuns';
import { Button, Field, IconButton, Select } from './ui';
import type { Notify } from './App';

// Nested group rectangles must not compete with rows during keyboard movement.
type KeyboardDrop = { id: string; data: Record<string, any> };
const sidebarKeyboardCoordinates = (
  event: KeyboardEvent,
  { context }: Parameters<KeyboardCoordinateGetter>[1],
  onTarget: (target: KeyboardDrop) => void,
) => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.code) || !context.active || !context.collisionRect)
    return;
  event.preventDefault();
  const active = context.active,
    rect = context.collisionRect;
  const enabled = context.droppableContainers.getEnabled();
  const isGroup = active.data.current?.kind === 'group';
  const center = rect.top + rect.height / 2;
  const candidates = enabled
    .filter((entry) => {
      if (entry.id === active.id) return false;
      const data = entry.data.current;
      if (isGroup) return data?.kind === 'group' && !!data.groupId;
      if (data?.kind === 'conversation') return true;
      return (
        data?.kind === 'bucket' &&
        !enabled.some(
          (row) =>
            row.data.current?.kind === 'conversation' &&
            (row.data.current.conversation.groupId || null) === data.groupId,
        )
      );
    })
    .map((entry) => ({ entry, rect: context.droppableRects.get(entry.id) }))
    .filter(
      (item) =>
        item.rect &&
        (event.code === 'ArrowUp'
          ? item.rect.top + item.rect.height / 2 < center - 1
          : item.rect.top + item.rect.height / 2 > center + 1),
    )
    .sort(
      (a, b) =>
        Math.abs(a.rect!.top + a.rect!.height / 2 - center) -
        Math.abs(b.rect!.top + b.rect!.height / 2 - center),
    );
  const target = candidates[0]?.rect;
  if (target) {
    onTarget({ id: String(candidates[0].entry.id), data: candidates[0].entry.data.current || {} });
    return {
      x: target.left + (target.width - rect.width) / 2,
      y: target.top + (target.height - rect.height) / 2,
    };
  }
};

type Props = {
  conversations: Conversation[];
  organization: ConversationOrganization;
  sessions: Record<string, ConversationSession>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onNew: (groupId: string | null) => void;
  onOrganize: (action: OrganizationAction) => Promise<void>;
  onUpdate: (c: Conversation, patch: Partial<Conversation>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  notify: Notify;
};
type Menu = { kind: 'conversation' | 'group'; id: string; x: number; y: number };
type Editor = { kind: 'conversation'; id: string } | { kind: 'group'; id?: string };

function ColorPicker({
  value,
  onChange,
  optional = false,
}: {
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  return (
    <div className="conversation-colors" role="group" aria-label="标记颜色">
      {optional && (
        <button
          type="button"
          aria-label="无颜色标记"
          aria-pressed={!value}
          onClick={() => onChange('')}
        >
          <X size={13} />
        </button>
      )}
      {conversationColors.map((c) => (
        <button
          type="button"
          key={c.value}
          aria-label={c.name}
          aria-pressed={value === c.value}
          onClick={() => onChange(c.value)}
          style={{ '--marker': c.value } as CSSProperties}
        >
          <i />
          {value === c.value && <Check size={12} />}
        </button>
      ))}
    </div>
  );
}

function ActionMenu({
  menu,
  close,
  children,
}: {
  menu: Menu;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.showPopover();
    const rect = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(menu.x, innerWidth - rect.width - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(menu.y, innerHeight - rect.height - 8)) + 'px';
    el.querySelector<HTMLButtonElement>('button')?.focus();
    const toggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'closed') close();
    };
    el.addEventListener('toggle', toggle);
    return () => {
      el.removeEventListener('toggle', toggle);
      el.hidePopover();
    };
  }, [menu]);
  return (
    <div
      ref={ref}
      popover="auto"
      className="conversation-menu"
      role="menu"
      aria-label={menu.kind === 'group' ? '分组操作' : '对话操作'}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const buttons = [
          ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        ];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? buttons.length - 1
              : (i + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
        ]?.focus();
      }}
    >
      {children}
    </div>
  );
}

function ConversationRow({
  c,
  active,
  session,
  disabled,
  onOpen,
  onMenu,
}: {
  c: Conversation;
  active: boolean;
  session?: ConversationSession;
  disabled: boolean;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const sortable = useSortable({
    id: 'conversation:' + c.id,
    data: { kind: 'conversation', conversation: c },
    disabled,
  });
  return (
    <div
      ref={sortable.setNodeRef}
      className={
        'history-row conversation-row ' +
        (active ? 'active ' : '') +
        (c.unread ? 'unread ' : '') +
        (sortable.isDragging ? 'is-dragging ' : '') +
        (sortable.isOver ? 'drop-row' : '')
      }
      style={
        {
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
          '--marker': c.color || 'transparent',
        } as CSSProperties
      }
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      <button className="history-title" onClick={onOpen} aria-current={active ? 'page' : undefined}>
        {session ? (
          <span
            className="running-session-dot"
            aria-label={session.approvals.length ? '等待确认' : '正在运行'}
            data-attention={!!session.approvals.length}
          />
        ) : c.pinned ? (
          <Pin size={13} />
        ) : (
          <MessageCircle size={14} />
        )}
        <span>{c.title}</span>
        {c.unread && <i className="conversation-unread" aria-label="未读" />}
        {c.color && (
          <i
            className="conversation-marker"
            title={
              '颜色标记 ' + (conversationColors.find((x) => x.value === c.color)?.name || c.color)
            }
          />
        )}
      </button>
      <button
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        className="conversation-grip"
        aria-label={'拖动对话 ' + c.title}
        title="拖动排序或移入分组；空格开始，方向键移动，空格放下，Esc 取消"
      >
        <GripVertical size={12} />
      </button>
      <IconButton
        label={'管理对话 ' + c.title}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(r.right, r.bottom);
        }}
      >
        <MoreHorizontal size={15} />
      </IconButton>
    </div>
  );
}

function GroupSection({
  group,
  collapsed,
  children,
  count,
  busyCount,
  attention,
  disabled,
  onToggle,
  onNew,
  onMenu,
}: {
  group: ConversationGroup | null;
  collapsed: boolean;
  children: ReactNode;
  count: number;
  busyCount: number;
  attention: boolean;
  disabled: boolean;
  onToggle: () => void;
  onNew: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const sortable = useSortable({
    id: 'group:' + (group?.id || 'ungrouped'),
    data: { kind: 'group', groupId: group?.id || null },
    disabled: !group || disabled,
  });
  const drop = useDroppable({
    id: 'bucket:' + (group?.id || 'ungrouped'),
    data: { kind: 'bucket', groupId: group?.id || null },
  });
  return (
    <section
      ref={sortable.setNodeRef}
      className={
        'conversation-group ' +
        (drop.isOver || sortable.isOver ? 'drop-group ' : '') +
        (sortable.isDragging ? 'is-dragging' : '')
      }
      style={
        {
          '--group-color': group?.color || 'var(--muted)',
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
        } as CSSProperties
      }
      aria-label={group?.name || '未分组'}
    >
      <div
        className="conversation-group-heading"
        ref={drop.setNodeRef}
        onContextMenu={(e) => {
          if (group) {
            e.preventDefault();
            onMenu(e.clientX, e.clientY);
          }
        }}
      >
        <button
          className="conversation-group-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          disabled={disabled}
          aria-label={(collapsed ? '展开分组 ' : '折叠分组 ') + (group?.name || '未分组')}
        >
          <ChevronDown size={12} className={collapsed ? 'collapsed' : ''} />
          {collapsed ? <Folder size={14} /> : <FolderOpen size={14} />}
          <span>{group?.name || '未分组'}</span>
          <small>{count}</small>
        </button>
        {busyCount > 0 && (
          <span
            className="group-activity"
            data-attention={attention}
            title={attention ? '组内有对话等待确认' : `${busyCount} 个对话正在运行`}
            aria-label={attention ? '组内有对话等待确认' : `${busyCount} 个对话正在运行`}
          />
        )}
        {group && (
          <button
            ref={sortable.setActivatorNodeRef}
            {...sortable.attributes}
            {...sortable.listeners}
            className="conversation-grip"
            aria-label={'拖动分组 ' + group.name}
          >
            <GripVertical size={12} />
          </button>
        )}
        <IconButton label={'在' + (group?.name || '未分组') + '中新建对话'} onClick={onNew}>
          <Plus size={13} />
        </IconButton>
        {group && (
          <IconButton
            label={'管理分组 ' + group.name}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onMenu(r.right, r.bottom);
            }}
          >
            <MoreHorizontal size={14} />
          </IconButton>
        )}
      </div>
      {!collapsed && (
        <div className="conversation-group-content">
          {children}
          {!count && <p className="group-empty">拖入对话，或点击 + 开始</p>}
        </div>
      )}
    </section>
  );
}

export function ConversationList(props: Props) {
  const {
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
  } = props;
  const [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false),
    [menu, setMenu] = useState<Menu | null>(null),
    [editor, setEditor] = useState<Editor | null>(null),
    [pending, setPending] = useState(false),
    [drag, setDrag] = useState<{ id: string; name: string } | null>(null);
  const lock = useRef(false);
  const keyboardDrop = useRef<KeyboardDrop | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event, args) =>
        sidebarKeyboardCoordinates(event, args, (target) => {
          keyboardDrop.current = target;
        }),
      scrollBehavior: 'auto',
    }),
  );
  const items = organizeConversations(
    conversations.map((c) =>
      sessions[c.id] && !organization.entries[c.id]?.title
        ? { ...c, title: sessions[c.id].conversation.title }
        : c,
    ),
    organization,
  );
  const filtered = items.filter(
    (c) =>
      !!c.archived === archived &&
      `${c.title} ${organization.groups.find((g) => g.id === c.groupId)?.name || ''}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const allCollapsed =
    organization.ungroupedCollapsed && organization.groups.every((g) => g.collapsed);
  const activeArchived = items.find((c) => c.id === selectedId)?.archived;
  useEffect(() => {
    if (selectedId) setArchived(!!activeArchived);
  }, [selectedId, activeArchived]);
  const draggingGroup = drag?.id.startsWith('group:');
  const collision: CollisionDetection = (args) => {
    const allowed = args.droppableContainers.filter((x) =>
      draggingGroup
        ? x.data.current?.kind === 'group' && !!x.data.current?.groupId
        : x.data.current?.kind !== 'group',
    );
    const hits = pointerWithin({ ...args, droppableContainers: allowed });
    return hits.length ? hits : closestCenter({ ...args, droppableContainers: allowed });
  };
  async function perform(action: () => Promise<void>, close = false) {
    if (lock.current) return false;
    lock.current = true;
    setPending(true);
    try {
      await action();
      if (close) setEditor(null);
      return true;
    } catch (e) {
      notify((e as Error).message, 'error');
      return false;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  function act(action: () => Promise<void>) {
    setMenu(null);
    void perform(action);
  }
  function endDrag(event: DragEndEvent) {
    setDrag(null);
    const { active } = event;
    const keyboardTarget = event.activatorEvent.type === 'keydown' ? keyboardDrop.current : null;
    const over = keyboardTarget
      ? { id: keyboardTarget.id, data: { current: keyboardTarget.data } }
      : event.over;
    keyboardDrop.current = null;
    if (!over || active.id === over.id || pending) return;
    const data = over.data.current;
    if (active.data.current?.kind === 'group') {
      const id = active.data.current.groupId as string;
      const target = data?.groupId as string;
      const groups = organization.groups;
      const from = groups.findIndex((g) => g.id === id),
        to = groups.findIndex((g) => g.id === target);
      if (from < 0 || to < 0) return;
      void perform(() =>
        onOrganize({
          type: 'reorder-group',
          id,
          beforeId: from < to ? groups[to + 1]?.id || null : target,
        }),
      );
    } else {
      const c = active.data.current?.conversation as Conversation;
      const target = data?.conversation as Conversation | undefined;
      if (!c || !data) return;
      const groupId = target?.groupId || data.groupId || null;
      const from = filtered.findIndex((x) => x.id === c.id),
        to = target ? filtered.findIndex((x) => x.id === target.id) : -1;
      void perform(() =>
        onOrganize({
          type: 'move',
          id: c.id,
          groupId,
          ...(target
            ? {
                targetId: target.id,
                placement: (c.groupId || null) === groupId && from < to ? 'after' : 'before',
              }
            : {}),
        }),
      );
    }
  }
  const menuConversation =
    menu?.kind === 'conversation' ? items.find((c) => c.id === menu.id) : undefined;
  const menuGroup =
    menu?.kind === 'group' ? organization.groups.find((g) => g.id === menu.id) : undefined;
  const editConversation =
    editor?.kind === 'conversation' ? items.find((c) => c.id === editor.id) : undefined;
  const editGroup =
    editor?.kind === 'group' ? organization.groups.find((g) => g.id === editor.id) : undefined;
  const row = (c: Conversation) => (
    <ConversationRow
      key={c.id}
      c={c}
      active={selectedId === c.id}
      session={sessions[c.id]}
      disabled={pending || !!query.trim()}
      onOpen={() => onOpen(c.id)}
      onMenu={(x, y) => setMenu({ kind: 'conversation', id: c.id, x, y })}
    />
  );
  return (
    <div className="conversation-sidebar">
      <div className="history-heading">
        <span>会话</span>
        <div className="conversation-heading-actions">
          <IconButton
            label={allCollapsed ? '展开全部分组' : '折叠全部分组'}
            disabled={pending}
            onClick={() =>
              void perform(() =>
                onOrganize({
                  type: 'collapse-all',
                  collapsed: !allCollapsed,
                }),
              )
            }
          >
            {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
          </IconButton>
          <IconButton
            label="新建分组"
            disabled={pending}
            onClick={() => {
              setMenu(null);
              setEditor({ kind: 'group' });
            }}
          >
            <FolderPlus size={15} />
          </IconButton>
        </div>
      </div>
      {editor ? (
        <SidebarEditor
          key={editor.kind + (editor.id || 'new')}
          editor={editor}
          conversation={editConversation}
          group={editGroup}
          groups={organization.groups}
          pending={pending}
          onCancel={() => setEditor(null)}
          onSubmit={(values) =>
            void perform(async () => {
              if (editor.kind === 'group')
                await onOrganize(
                  editGroup
                    ? {
                        type: 'update-group',
                        id: editGroup.id,
                        patch: { name: values.name, color: values.color },
                      }
                    : { type: 'create-group', name: values.name, color: values.color },
                );
              else if (editConversation)
                await onUpdate(editConversation, {
                  title: values.name,
                  color: values.color,
                  groupId: values.groupId || null,
                });
            }, true)
          }
          onDelete={() =>
            void perform(async () => {
              if (editor.kind === 'group' && editGroup)
                await onOrganize({ type: 'delete-group', id: editGroup.id });
              else if (editConversation) await onDelete(editConversation.id);
            }, true)
          }
        />
      ) : (
        <>
          <div className="conversation-search">
            <Search size={13} />
            <input
              aria-label="搜索会话"
              type="search"
              placeholder="搜索会话或分组"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <IconButton label="清除会话搜索" onClick={() => setQuery('')}>
                <X size={12} />
              </IconButton>
            )}
          </div>
          <div className="conversation-tabs" role="group" aria-label="会话范围">
            <button aria-pressed={!archived} onClick={() => setArchived(false)}>
              最近 <small>{items.filter((c) => !c.archived).length}</small>
            </button>
            <button aria-pressed={archived} onClick={() => setArchived(true)}>
              <Archive size={11} />
              归档 <small>{items.filter((c) => c.archived).length}</small>
            </button>
          </div>
          <div className="history-list" aria-busy={pending}>
            <DndContext
              sensors={sensors}
              collisionDetection={collision}
              onDragStart={({ active }) => {
                keyboardDrop.current = null;
                setMenu(null);
                const data = active.data.current;
                setDrag({
                  id: String(active.id),
                  name:
                    data?.kind === 'group'
                      ? organization.groups.find((g) => g.id === data.groupId)?.name || '分组'
                      : data?.conversation.title || '对话',
                });
              }}
              onDragEnd={endDrag}
              onDragCancel={() => setDrag(null)}
              accessibility={{
                screenReaderInstructions: {
                  draggable:
                    '按空格开始拖动，方向键移动，空格放下，Escape 取消。也可以通过管理菜单移动分组。',
                },
                announcements: {
                  onDragStart: () => '已开始拖动',
                  onDragOver: ({ over }) => (over ? '已进入可放置位置' : '当前位置不可放置'),
                  onDragEnd: ({ over }) => (over ? '已放下，正在保存顺序' : '已取消移动'),
                  onDragCancel: () => '已取消拖动',
                },
              }}
            >
              <SortableContext
                items={organization.groups.map((g) => 'group:' + g.id)}
                strategy={verticalListSortingStrategy}
              >
                {[...organization.groups, null]
                  .filter(
                    (g) =>
                      !query.trim() ||
                      filtered.some((c) => (c.groupId || null) === (g?.id || null)) ||
                      g?.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
                  )
                  .map((group) => {
                    const members = filtered.filter(
                      (c) => (c.groupId || null) === (group?.id || null),
                    );
                    const running = members.filter((c) => sessions[c.id]);
                    const displayGroup =
                      query.trim() && group ? { ...group, collapsed: false } : group;
                    return (
                      <GroupSection
                        key={group?.id || 'ungrouped'}
                        group={displayGroup}
                        collapsed={
                          !query.trim() &&
                          (group ? group.collapsed : organization.ungroupedCollapsed)
                        }
                        count={members.length}
                        busyCount={running.length}
                        attention={running.some((c) => sessions[c.id].approvals.length > 0)}
                        disabled={pending || !!query.trim()}
                        onToggle={() => {
                          if (group)
                            void perform(() =>
                              onOrganize({
                                type: 'update-group',
                                id: group.id,
                                patch: { collapsed: !group.collapsed },
                              }),
                            );
                          else
                            void perform(() =>
                              onOrganize({
                                type: 'collapse-ungrouped',
                                collapsed: !organization.ungroupedCollapsed,
                              }),
                            );
                        }}
                        onNew={() => {
                          if (group?.collapsed)
                            void perform(() =>
                              onOrganize({
                                type: 'update-group',
                                id: group.id,
                                patch: { collapsed: false },
                              }),
                            );
                          else if (!group && organization.ungroupedCollapsed)
                            void perform(() =>
                              onOrganize({ type: 'collapse-ungrouped', collapsed: false }),
                            );
                          onNew(group?.id || null);
                        }}
                        onMenu={(x, y) => {
                          if (group) setMenu({ kind: 'group', id: group.id, x, y });
                        }}
                      >
                        <SortableContext
                          items={members.map((c) => 'conversation:' + c.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {members.map(row)}
                        </SortableContext>
                      </GroupSection>
                    );
                  })}
              </SortableContext>
              <DragOverlay dropAnimation={null}>
                {drag && (
                  <div className="conversation-drag-preview">
                    <GripVertical size={14} />
                    {drag.name}
                  </div>
                )}
              </DragOverlay>
            </DndContext>
            {!filtered.length && query && <p className="no-history">没有匹配的会话</p>}
          </div>
        </>
      )}
      {menu && (menuConversation || menuGroup) && (
        <ActionMenu menu={menu} close={() => setMenu(null)}>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null);
              setEditor({ kind: menu.kind, id: menu.id });
            }}
          >
            <Pencil size={14} />
            {menuGroup ? '编辑分组与颜色' : '名称、颜色与分组'}
          </button>
          {menuConversation && (
            <>
              <button
                role="menuitem"
                disabled={pending}
                onClick={() =>
                  act(() => onUpdate(menuConversation, { pinned: !menuConversation.pinned }))
                }
              >
                <Pin size={14} />
                {menuConversation.pinned ? '取消置顶' : '置顶对话'}
              </button>
              <button
                role="menuitem"
                disabled={pending}
                onClick={() =>
                  act(() => onUpdate(menuConversation, { unread: !menuConversation.unread }))
                }
              >
                {menuConversation.unread ? <MailOpen size={14} /> : <Mail size={14} />}
                {menuConversation.unread ? '标记已读' : '标记未读'}
              </button>
              <button
                role="menuitem"
                disabled={pending}
                onClick={() =>
                  act(() => onUpdate(menuConversation, { archived: !menuConversation.archived }))
                }
              >
                <Archive size={14} />
                {menuConversation.archived ? '移回最近会话' : '归档对话'}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  setEditor({ kind: 'conversation', id: menuConversation.id });
                }}
              >
                <ArrowUpDown size={14} />
                移入或移出分组
              </button>
            </>
          )}
          {menuGroup && (
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                onNew(menuGroup.id);
              }}
            >
              <Plus size={14} />
              在分组中新建对话
            </button>
          )}
          <button
            role="menuitem"
            className="danger"
            onClick={() => {
              setMenu(null);
              setEditor({ kind: menu.kind, id: menu.id });
            }}
          >
            <Trash2 size={14} />
            {menuGroup ? '移除分组…' : '删除对话…'}
          </button>
        </ActionMenu>
      )}
    </div>
  );
}

function SidebarEditor({
  editor,
  conversation,
  group,
  groups,
  pending,
  onCancel,
  onSubmit,
  onDelete,
}: {
  editor: Editor;
  conversation?: Conversation;
  group?: ConversationGroup;
  groups: ConversationGroup[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: { name: string; color: string; groupId: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(group?.name || conversation?.title || ''),
    [color, setColor] = useState(
      group?.color ||
        conversation?.color ||
        (editor.kind === 'group' ? conversationColors[0].value : ''),
    ),
    [groupId, setGroupId] = useState(conversation?.groupId || ''),
    [deleting, setDeleting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <form
      className="conversation-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && !pending) onSubmit({ name: name.trim(), color, groupId });
      }}
    >
      <button
        type="button"
        className="conversation-editor-back"
        onClick={onCancel}
        disabled={pending}
      >
        <ArrowLeft size={14} />
        返回会话
      </button>
      <h3>{editor.kind === 'group' ? (group ? '编辑分组' : '新建分组') : '整理对话'}</h3>
      <Field label={editor.kind === 'group' ? '分组名称' : '对话名称'}>
        <input
          ref={input}
          type="text"
          value={name}
          maxLength={editor.kind === 'group' ? 24 : 100}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="标记颜色">
        <ColorPicker value={color} onChange={setColor} optional={editor.kind === 'conversation'} />
      </Field>
      {editor.kind === 'conversation' && (
        <Field label="所在分组">
          <Select
            value={groupId}
            options={[
              { value: '', label: '未分组' },
              ...groups.map((g) => ({ value: g.id, label: g.name })),
            ]}
            onChange={setGroupId}
          />
        </Field>
      )}
      <div className="conversation-editor-actions">
        <Button type="button" onClick={onCancel} disabled={pending}>
          取消
        </Button>
        <Button type="submit" variant="primary" disabled={!name.trim()} busy={pending}>
          保存
        </Button>
      </div>
      {(group || conversation) && (
        <div className="conversation-remove">
          {deleting ? (
            <>
              <p>
                {group
                  ? '只移除分组，所有会话将回到未分组。'
                  : '永久删除这段对话？此操作无法撤销。'}
              </p>
              <Button type="button" variant="danger" busy={pending} onClick={onDelete}>
                {group ? '确认移除分组' : '确认删除对话'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setDeleting(false)}
              >
                保留
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={13} />
              {group ? '移除分组，保留会话' : '删除这段对话'}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
