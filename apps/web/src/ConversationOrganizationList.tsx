import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Loader2,
  MessageSquare,
  Pin,
  Plus,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
// Ported from lumen-utools/src/ConversationList.tsx. Keep its menu and dialog design in sync.
import type { Conversation, ConversationGroup } from '@livra/shared';
import { conversationColors } from '@livra/shared';
import { Field, IconButton, Modal } from './ui';
const CONVERSATION_TITLE_MAX = 100;
const GROUP_NAME_MAX = 24;
const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ');
export type ConversationAction =
  | { type: 'group-create'; group: ConversationGroup; conversationId?: string }
  | { type: 'group-edit'; id: string; name: string; color: string }
  | { type: 'group-delete'; id: string }
  | { type: 'group-collapse'; id?: string; collapsed: boolean }
  | { type: 'collapse-all'; collapsed: boolean }
  | { type: 'group-reorder'; id: string; targetId: string; after: boolean }
  | { type: 'rename'; id: string; title: string }
  | { type: 'color'; id: string; color?: string }
  | { type: 'move'; id: string; groupId?: string }
  | { type: 'pin'; id: string; pinned: boolean }
  | { type: 'archive'; id: string; archived: boolean }
  | { type: 'unread'; id: string; unread: boolean }
  | { type: 'delete'; id: string }
  | { type: 'reorder'; id: string; targetId: string; after: boolean };
type Row = Pick<
  Conversation,
  'id' | 'title' | 'groupId' | 'color' | 'pinned' | 'archived' | 'unread'
>;
type Props = {
  conversations: Row[];
  groups: ConversationGroup[];
  ungroupedCollapsed?: boolean;
  activeId?: string;
  sessions: Record<string, { approvals: unknown[] }>;
  pending: boolean;
  onSelect: (id: string) => void;
  onNew: (groupId?: string) => void;
  onAction: (action: ConversationAction) => Promise<boolean>;
  onExport: (id: string) => void;
  notify: (text: string) => void;
};
type Dialog =
  | { kind: 'create'; conversationId?: string }
  | { kind: 'edit-group' | 'delete-group'; id: string }
  | { kind: 'rename' | 'move' | 'delete'; id: string };
type DragSource = { kind: 'conversation' | 'group'; id: string };
type DropTarget = DragSource & { after: boolean };
type MenuTarget = DragSource & { x: number; y: number };
const MIME = 'application/x-lumen-conversation';
export function ConversationOrganizationList(props: Props) {
  const {
    conversations,
    groups,
    activeId,
    sessions,
    pending,
    onSelect,
    onNew,
    onAction,
    onExport,
    notify,
  } = props;
  const [archived, setArchived] = useState(false);
  const [menu, setMenu] = useState<MenuTarget>();
  const [dialog, setDialog] = useState<Dialog>();
  const [drag, setDrag] = useState<DragSource>();
  const [drop, setDrop] = useState<DropTarget>();
  const dragSource = useRef<DragSource | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const dragY = useRef<number | undefined>(undefined);
  const pool = conversations.filter((c) => !!c.archived === archived);
  const segments = groups.length
    ? [
        ...groups,
        {
          id: '',
          name: '未分组',
          color: '',
          collapsed: props.ungroupedCollapsed,
        },
      ]
    : [{ id: '', name: '你的对话', color: '', collapsed: false }];
  const allCollapsed = segments.every((g) => g.collapsed);
  const activeArchived = conversations.find((c) => c.id === activeId)?.archived;

  useEffect(() => {
    if (!drag) return;
    let frame: number;
    const scroll = () => {
      const el = listRef.current;
      const y = dragY.current;
      if (el && y !== undefined) {
        const rect = el.getBoundingClientRect();
        const offset =
          y < rect.top + 35
            ? -Math.min(10, (rect.top + 35 - y) / 4)
            : y > rect.bottom - 35
              ? Math.min(10, (y - rect.bottom + 35) / 4)
              : 0;
        if (y >= rect.top && y <= rect.bottom) el.scrollTop += offset;
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    const cancel = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') clearDrag();
    };
    window.addEventListener('keydown', cancel);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', cancel);
    };
  }, [drag]);
  // Reveal a selected conversation when arriving from global search, including archived results.
  useEffect(() => {
    if (activeId) setArchived(!!activeArchived);
  }, [activeId, activeArchived]);

  const clearDrag = () => {
    dragSource.current = undefined;
    dragY.current = undefined;
    setDrag(undefined);
    setDrop(undefined);
  };
  const startDrag = (e: DragEvent, source: DragSource) => {
    e.stopPropagation();
    dragSource.current = source;
    setDrag(source);
    setMenu(undefined);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(MIME, JSON.stringify(source));
  };
  const dragOver = (e: DragEvent<HTMLElement>, kind: DragSource['kind'], id: string) => {
    const source = dragSource.current;
    if (!source || (kind === 'conversation' && source.kind !== 'conversation')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    dragY.current = e.clientY;
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDrop((current) =>
      current?.kind === kind && current.id === id && current.after === after
        ? current
        : { kind, id, after },
    );
  };
  const dropOn = (e: DragEvent, kind: DragSource['kind'], id: string) => {
    const source = dragSource.current;
    if (!source || (kind === 'conversation' && source.kind !== 'conversation')) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    if (source.kind === 'conversation') {
      if (kind === 'group') onAction({ type: 'move', id: source.id, groupId: id || undefined });
      else
        onAction({
          type: 'reorder',
          id: source.id,
          targetId: id,
          after,
        });
    } else if (kind === 'group' && id)
      onAction({
        type: 'group-reorder',
        id: source.id,
        targetId: id,
        after,
      });
    clearDrag();
  };
  const openMenu = (kind: DragSource['kind'], id: string, x: number, y: number) =>
    setMenu({ kind, id, x, y });
  const moveRow = (c: Row, direction: number) => {
    const peers = pool.filter((x) => x.groupId === c.groupId && !!x.pinned === !!c.pinned);
    const target = peers[peers.findIndex((x) => x.id === c.id) + direction];
    if (target)
      onAction({
        type: 'reorder',
        id: c.id,
        targetId: target.id,
        after: direction > 0,
      });
  };
  const moveGroup = (id: string, direction: number) => {
    const target = groups[groups.findIndex((g) => g.id === id) + direction];
    if (target)
      onAction({
        type: 'group-reorder',
        id,
        targetId: target.id,
        after: direction > 0,
      });
  };
  const keyboardMove = (e: KeyboardEvent, move: (direction: number) => void) => {
    if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    move(e.key === 'ArrowUp' ? -1 : 1);
  };
  const row = (c: Row) => (
    <div
      key={c.id}
      data-conversation-id={c.id}
      className={cx(
        'history-item',
        activeId === c.id && 'active',
        c.unread && 'unread',
        drag?.id === c.id && 'is-dragging',
        drop?.kind === 'conversation' &&
          drop.id === c.id &&
          (drop.after ? 'drop-after' : 'drop-before'),
      )}
      draggable
      onDragStart={(e) => startDrag(e, { kind: 'conversation', id: c.id })}
      onDragEnd={clearDrag}
      onDragOver={(e) => dragOver(e, 'conversation', c.id)}
      onDragEnter={(e) => dragOver(e, 'conversation', c.id)}
      onDrop={(e) => dropOn(e, 'conversation', c.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu('conversation', c.id, e.clientX, e.clientY);
      }}
    >
      <span className="history-drag-handle" aria-hidden="true">
        <GripVertical size={12} />
      </span>
      <button
        className="history-title"
        onClick={() => onSelect(c.id)}
        onDoubleClick={() => setDialog({ kind: 'rename', id: c.id })}
        title={`${c.title} · Alt + ↑ / ↓ 排序`}
        onKeyDown={(e) => keyboardMove(e, (direction) => moveRow(c, direction))}
        aria-current={activeId === c.id ? 'page' : undefined}
      >
        {c.color ? (
          <span
            className="conversation-color-dot"
            style={{ background: c.color }}
            role="img"
            aria-label={`颜色标记 ${c.color}`}
          />
        ) : c.pinned ? (
          <Pin size={12} />
        ) : (
          <MessageSquare size={13} />
        )}
        <span>{c.title}</span>
        {c.color && c.pinned && <Pin size={10} className="conversation-pin" />}
        {!!sessions[c.id] && (
          <Loader2
            size={12}
            className={cx('spin', !!sessions[c.id]?.approvals.length && 'conversation-waiting')}
            aria-label={sessions[c.id]?.approvals.length ? '等待授权' : '正在回复'}
          />
        )}
        {c.unread && <span className="conversation-unread" aria-label="未读" />}
      </button>
      <IconButton
        label={`对话操作 ${c.title}`}
        aria-haspopup="menu"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          openMenu('conversation', c.id, rect.right, rect.bottom);
        }}
      >
        <Ellipsis size={15} />
      </IconButton>
    </div>
  );
  const menuConversation =
    menu?.kind === 'conversation' ? conversations.find((c) => c.id === menu.id) : undefined;
  const menuGroup = menu?.kind === 'group' ? groups.find((g) => g.id === menu.id) : undefined;
  const menuPeers = menuConversation
    ? pool.filter(
        (c) => c.groupId === menuConversation.groupId && !!c.pinned === !!menuConversation.pinned,
      )
    : [];
  const menuIndex = menuPeers.findIndex((c) => c.id === menuConversation?.id);
  const closeMenu = () => setMenu(undefined);
  const menuAction = (action: ConversationAction) => {
    onAction(action);
    closeMenu();
  };

  return (
    <>
      <div className="history-heading">
        <span>
          你的对话 <span className="history-count">{conversations.length || ''}</span>
        </span>
        <div className="history-heading-actions">
          {!!groups.length && (
            <IconButton
              label={allCollapsed ? '展开全部分组' : '收起全部分组'}
              onClick={() => onAction({ type: 'collapse-all', collapsed: !allCollapsed })}
            >
              {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
            </IconButton>
          )}
          <IconButton label="新建分组" onClick={() => setDialog({ kind: 'create' })}>
            <FolderPlus size={14} />
          </IconButton>
        </div>
      </div>
      <div className="conversation-tabs" role="tablist" aria-label="会话列表">
        <button role="tab" aria-selected={!archived} onClick={() => setArchived(false)}>
          对话 <span>{conversations.filter((c) => !c.archived).length}</span>
        </button>
        <button role="tab" aria-selected={archived} onClick={() => setArchived(true)}>
          归档 <span>{conversations.filter((c) => c.archived).length}</span>
        </button>
      </div>
      <div
        className="history-list"
        ref={listRef}
        onDragLeave={(e) => {
          if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
            dragY.current = undefined;
            setDrop(undefined);
          }
        }}
      >
        {!pool.length && !groups.length && (
          <div className="history-empty">
            <MessageSquare size={21} />
            <p>{archived ? '归档后的对话会留在这里。' : '从一次对话开始。'}</p>
          </div>
        )}
        {segments.map((group) => {
          const members = pool.filter((c) => (c.groupId || '') === group.id);
          const pinned = members.filter((c) => c.pinned);
          const rest = members.filter((c) => !c.pinned);
          const grouped = !!groups.length;
          const highlighted = drop?.kind === 'group' && drop.id === group.id;
          return (
            <section
              key={group.id}
              className={cx(
                'conversation-group',
                highlighted && drag?.kind === 'conversation' && 'drop-into',
              )}
              data-group-id={group.id}
              onDragOver={(e) => dragOver(e, 'group', group.id)}
              onDragEnter={(e) => dragOver(e, 'group', group.id)}
              onDrop={(e) => dropOn(e, 'group', group.id)}
            >
              {grouped && (
                <div
                  className={cx(
                    'conversation-group-header',
                    highlighted &&
                      drag?.kind === 'group' &&
                      (drop.after ? 'drop-after' : 'drop-before'),
                    drag?.kind === 'group' && drag.id === group.id && 'is-dragging',
                  )}
                  draggable={!!group.id}
                  onDragStart={(e) => startDrag(e, { kind: 'group', id: group.id })}
                  onDragEnd={clearDrag}
                  onDragOver={(e) => dragOver(e, 'group', group.id)}
                  onDragEnter={(e) => dragOver(e, 'group', group.id)}
                  onDrop={(e) => dropOn(e, 'group', group.id)}
                  onContextMenu={(e) => {
                    if (group.id) {
                      e.preventDefault();
                      openMenu('group', group.id, e.clientX, e.clientY);
                    }
                  }}
                >
                  <button
                    className="conversation-group-toggle"
                    aria-label={`${group.collapsed ? '展开' : '收起'}分组 ${group.name}`}
                    aria-expanded={!group.collapsed}
                    onClick={() =>
                      onAction({
                        type: 'group-collapse',
                        id: group.id || undefined,
                        collapsed: !group.collapsed,
                      })
                    }
                    onKeyDown={(e) =>
                      keyboardMove(e, (direction) => moveGroup(group.id, direction))
                    }
                  >
                    <ChevronDown
                      size={12}
                      className={cx('group-chevron', group.collapsed && 'collapsed')}
                    />
                    {group.collapsed ? (
                      <Folder size={14} style={{ color: group.color || undefined }} />
                    ) : (
                      <FolderOpen size={14} style={{ color: group.color || undefined }} />
                    )}
                    <span>{group.name}</span>
                    <small>{members.length}</small>
                    {group.collapsed && members.some((c) => !!sessions[c.id]) && (
                      <Loader2 size={11} className="spin" />
                    )}
                  </button>
                  {!archived && (
                    <IconButton
                      label={`在${group.name}中新建对话`}
                      onClick={() => {
                        onAction({
                          type: 'group-collapse',
                          id: group.id || undefined,
                          collapsed: false,
                        });
                        onNew(group.id || undefined);
                      }}
                    >
                      <Plus size={13} />
                    </IconButton>
                  )}
                  {!!group.id && (
                    <IconButton
                      label={`分组操作 ${group.name}`}
                      aria-haspopup="menu"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        openMenu('group', group.id, rect.right, rect.bottom);
                      }}
                    >
                      <Ellipsis size={13} />
                    </IconButton>
                  )}
                </div>
              )}
              <div
                className={cx(
                  'conversation-group-items',
                  grouped && group.collapsed && 'collapsed',
                )}
                inert={grouped && group.collapsed}
                aria-hidden={(grouped && group.collapsed) || undefined}
              >
                <div>
                  {pinned.length > 0 && (
                    <>
                      <div className="conversation-zone-label">
                        <Pin size={10} />
                        置顶
                      </div>
                      {pinned.map(row)}
                      {rest.length > 0 && <div className="conversation-zone-divider" />}
                    </>
                  )}
                  {rest.map(row)}
                  {grouped && !members.length && (
                    <div className="conversation-group-empty">
                      {drag?.kind === 'conversation' ? '松开以移入' : '暂无对话'}
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>
      {menu && (menuConversation || menuGroup) && (
        <ConversationMenu position={menu} onClose={closeMenu}>
          {menuConversation && (
            <>
              <MenuItem
                icon={<SquarePen size={14} />}
                onClick={() => {
                  setDialog({ kind: 'rename', id: menu.id });
                  closeMenu();
                }}
              >
                重命名
              </MenuItem>
              <MenuItem
                icon={<Pin size={14} />}
                onClick={() =>
                  menuAction({
                    type: 'pin',
                    id: menu.id,
                    pinned: !menuConversation.pinned,
                  })
                }
              >
                {menuConversation.pinned ? '取消置顶' : '置顶对话'}
              </MenuItem>
              <MenuItem
                icon={<FolderOpen size={14} />}
                onClick={() => {
                  setDialog({ kind: 'move', id: menu.id });
                  closeMenu();
                }}
              >
                移入分组
              </MenuItem>
              <div className="conversation-menu-colors">
                <span>颜色标记</span>
                <ColorPicker
                  value={menuConversation.color}
                  clearable
                  onChange={(color) => menuAction({ type: 'color', id: menu.id, color })}
                />
              </div>
              <div className="conversation-menu-divider" />
              <MenuItem
                icon={<MessageSquare size={14} />}
                onClick={() =>
                  menuAction({
                    type: 'unread',
                    id: menu.id,
                    unread: !menuConversation.unread,
                  })
                }
              >
                {menuConversation.unread ? '标记已读' : '标记未读'}
              </MenuItem>
              <MenuItem
                icon={<Copy size={14} />}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(menu.id)
                    .then(() => notify('已复制会话 ID'))
                    .catch(() => notify('复制失败，请重试'));
                  closeMenu();
                }}
              >
                复制会话 ID
              </MenuItem>
              <MenuItem
                icon={<ArrowUp size={14} />}
                disabled={menuIndex <= 0}
                onClick={() => {
                  moveRow(menuConversation, -1);
                  closeMenu();
                }}
              >
                上移
              </MenuItem>
              <MenuItem
                icon={<ArrowDown size={14} />}
                disabled={menuIndex >= menuPeers.length - 1}
                onClick={() => {
                  moveRow(menuConversation, 1);
                  closeMenu();
                }}
              >
                下移
              </MenuItem>
              <MenuItem
                icon={
                  menuConversation.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />
                }
                onClick={() =>
                  menuAction({
                    type: 'archive',
                    id: menu.id,
                    archived: !menuConversation.archived,
                  })
                }
              >
                {menuConversation.archived ? '恢复对话' : '归档对话'}
              </MenuItem>
              <MenuItem
                icon={<ArrowDown size={14} />}
                onClick={() => {
                  onExport(menu.id);
                  closeMenu();
                }}
              >
                导出 Markdown
              </MenuItem>
              <div className="conversation-menu-divider" />
              <MenuItem
                danger
                icon={<Trash2 size={14} />}
                onClick={() => {
                  setDialog({ kind: 'delete', id: menu.id });
                  closeMenu();
                }}
              >
                删除对话
              </MenuItem>
            </>
          )}
          {menuGroup && (
            <>
              <MenuItem
                icon={<SquarePen size={14} />}
                onClick={() => {
                  setDialog({ kind: 'edit-group', id: menu.id });
                  closeMenu();
                }}
              >
                编辑分组
              </MenuItem>
              <MenuItem
                icon={<Plus size={14} />}
                onClick={() => {
                  onNew(menu.id);
                  closeMenu();
                }}
              >
                在分组中新建对话
              </MenuItem>
              <MenuItem
                icon={<ArrowUp size={14} />}
                disabled={groups[0]?.id === menuGroup.id}
                onClick={() => {
                  moveGroup(menu.id, -1);
                  closeMenu();
                }}
              >
                上移分组
              </MenuItem>
              <MenuItem
                icon={<ArrowDown size={14} />}
                disabled={groups.at(-1)?.id === menuGroup.id}
                onClick={() => {
                  moveGroup(menu.id, 1);
                  closeMenu();
                }}
              >
                下移分组
              </MenuItem>
              <div className="conversation-menu-divider" />
              <MenuItem
                danger
                icon={<Trash2 size={14} />}
                onClick={() => {
                  setDialog({ kind: 'delete-group', id: menu.id });
                  closeMenu();
                }}
              >
                删除分组
              </MenuItem>
            </>
          )}
        </ConversationMenu>
      )}
      {dialog && (
        <ConversationDialog
          key={JSON.stringify(dialog)}
          dialog={dialog}
          groups={groups}
          conversations={conversations}
          onAction={onAction}
          onDialog={setDialog}
          onClose={() => {
            if (!pending) setDialog(undefined);
          }}
          pending={pending}
        />
      )}
    </>
  );
}

function MenuItem({
  icon,
  children,
  danger,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      className={cx(danger && 'danger-text')}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
function ConversationMenu({
  position,
  onClose,
  children,
}: {
  position: MenuTarget;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({
    left: position.x,
    top: position.y,
  });
  useLayoutEffect(() => {
    const element = ref.current!;
    element.showPopover();
    const toggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed') onClose();
    };
    element.addEventListener('toggle', toggle);
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setPlacement({
        left: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      element.removeEventListener('toggle', toggle);
      element.hidePopover();
    };
  }, [position]);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
  }, []);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="会话操作菜单"
      popover="auto"
      className="conversation-menu"
      style={placement}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
          return;
        }
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const buttons = [
          ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button[role="menuitem"]:not(:disabled)',
          ),
        ];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? buttons.length - 1
              : (i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
        ]?.focus();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
function ColorPicker({
  value,
  onChange,
  clearable = false,
}: {
  value?: string;
  onChange: (color?: string) => void;
  clearable?: boolean;
}) {
  return (
    <div className="conversation-color-picker" role="group" aria-label="选择标记颜色">
      {conversationColors.map((c) => (
        <button
          type="button"
          key={c.value}
          aria-label={`标记为${c.name}`}
          title={c.name}
          aria-pressed={value?.toLowerCase() === c.value}
          style={{ '--swatch': c.value } as CSSProperties}
          onClick={() => onChange(c.value)}
        >
          {value?.toLowerCase() === c.value && <Check size={12} />}
        </button>
      ))}
      <label className="conversation-custom-color" title="自定义颜色">
        <Plus size={12} />
        <input
          type="color"
          aria-label="自定义标记颜色"
          value={value || conversationColors[0].value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {clearable && (
        <button
          type="button"
          className="conversation-clear-color"
          aria-label="清除颜色标记"
          title="清除标记"
          onClick={() => onChange(undefined)}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
function ConversationDialog({
  dialog,
  groups,
  conversations,
  onAction,
  onDialog,
  onClose,
  pending,
}: {
  pending: boolean;
  dialog: Dialog;
  groups: ConversationGroup[];
  conversations: Row[];
  onAction: Props['onAction'];
  onDialog: (d: Dialog) => void;
  onClose: () => void;
}) {
  const current = 'id' in dialog ? conversations.find((c) => c.id === dialog.id) : undefined;
  const group = 'id' in dialog ? groups.find((g) => g.id === dialog.id) : undefined;
  const [name, setName] = useState(
    dialog.kind === 'rename' ? current?.title || '' : group?.name || '',
  );
  const [color, setColor] = useState(group?.color || (conversationColors[0].value as string));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const submit = async (action: ConversationAction) => {
    if (await onAction(action)) onClose();
  };
  const title = {
    create: '新建分组',
    'edit-group': '编辑分组',
    'delete-group': '删除分组',
    rename: '重命名对话',
    move: '移入分组',
    delete: '删除对话',
  }[dialog.kind];
  const duplicate = groups.some(
    (g) => g.id !== group?.id && g.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  return createPortal(
    <Modal title={title} onClose={onClose} className="conversation-modal">
      <fieldset disabled={pending} className="conversation-dialog" aria-busy={pending}>
        {dialog.kind === 'move' ? (
          <>
            <div className="conversation-move-list">
              {[{ id: '', name: '未分组', color: '' }, ...groups].map((g) => (
                <button
                  key={g.id}
                  onClick={() =>
                    submit({
                      type: 'move',
                      id: dialog.id,
                      groupId: g.id || undefined,
                    })
                  }
                >
                  <Folder size={17} style={{ color: g.color || undefined }} />
                  <span>{g.name}</span>
                  {(current?.groupId || '') === g.id && <Check size={15} />}
                </button>
              ))}
            </div>
            <button
              className="button"
              onClick={() => onDialog({ kind: 'create', conversationId: dialog.id })}
            >
              <FolderPlus size={15} />
              新建分组并移入
            </button>
          </>
        ) : dialog.kind === 'delete' || dialog.kind === 'delete-group' ? (
          <>
            <p className="conversation-confirm">
              {dialog.kind === 'delete-group'
                ? `删除「${group?.name || '此分组'}」？组内对话将移回未分组。`
                : `删除「${current?.title || '此对话'}」？删除后无法在界面中恢复。`}
            </p>
            <footer>
              <button className="button" onClick={onClose}>
                取消
              </button>
              <button
                className="button danger"
                onClick={() =>
                  submit({
                    type: dialog.kind === 'delete' ? 'delete' : 'group-delete',
                    id: dialog.id,
                  })
                }
              >
                {title}
              </button>
            </footer>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || (dialog.kind !== 'rename' && duplicate)) return;
              submit(
                dialog.kind === 'rename'
                  ? { type: 'rename', id: dialog.id, title: name }
                  : dialog.kind === 'edit-group'
                    ? { type: 'group-edit', id: dialog.id, name, color }
                    : {
                        type: 'group-create',
                        group: { id: crypto.randomUUID(), name, color, collapsed: false },
                        conversationId:
                          dialog.kind === 'create' ? dialog.conversationId : undefined,
                      },
              );
            }}
          >
            <Field label={dialog.kind === 'rename' ? '对话名称' : '分组名称'}>
              <input
                ref={input}
                data-autofocus
                value={name}
                maxLength={dialog.kind === 'rename' ? CONVERSATION_TITLE_MAX : GROUP_NAME_MAX}
                placeholder={dialog.kind === 'rename' ? '为这段对话命名' : '例如：工作、学习、灵感'}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing && e.key === 'Enter') e.preventDefault();
                }}
              />
            </Field>
            {dialog.kind !== 'rename' && (
              <>
                <Field label="标记颜色">
                  <ColorPicker
                    value={color}
                    onChange={(c) => setColor(c || conversationColors[0].value)}
                  />
                </Field>
                {duplicate && (
                  <p className="conversation-form-error" role="alert">
                    已存在同名分组
                  </p>
                )}
              </>
            )}
            <footer>
              <button type="button" className="button" onClick={onClose}>
                取消
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={!name.trim() || (dialog.kind !== 'rename' && duplicate)}
              >
                <Check size={14} />
                {dialog.kind === 'create' ? '创建分组' : '保存'}
              </button>
            </footer>
          </form>
        )}
      </fieldset>
    </Modal>,
    document.body,
  );
}
