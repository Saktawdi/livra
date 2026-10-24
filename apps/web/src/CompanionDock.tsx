import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, PanelRight, Sparkles } from 'lucide-react';
import type { Settings, Persona } from '@livra/shared';
import type { ConversationSession } from './useConversationRuns';
import { LiveAvatar } from './LiveAvatar';
import { IconButton } from './ui';

const labels: Record<string, string> = {
  web_search: '正在查找资料',
  create_slides: '正在制作演示',
  create_marp_theme: '正在设计主题',
  generate_image: '正在绘图',
  generate_music: '正在创作音乐',
  create_persona: '正在设计人偶',
};
function clamp(point: { x: number; y: number }, width: number, height: number) {
  return {
    x: Math.max(8, Math.min(point.x, innerWidth - width - 8)),
    y: Math.max(8, Math.min(point.y, innerHeight - height - 8)),
  };
}
export function CompanionDock({
  settings,
  persona,
  sessions,
  selectedId,
  onOpen,
  onDock,
}: {
  settings: Settings;
  persona: Persona;
  sessions: Record<string, ConversationSession>;
  selectedId?: string;
  onOpen: (id?: string) => void;
  onDock: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const [actions, setActions] = useState(false);
  const [gesture, setGesture] = useState({ id: 0, key: 'reset' });
  const [position, setPosition] = useState(() => {
    try {
      const point = JSON.parse(localStorage.getItem('livra:companion-position') || 'null');
      if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) return clamp(point, 224, 280);
    } catch {}
    return clamp({ x: innerWidth - 248, y: innerHeight - 310 }, 224, 280);
  });
  const host = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!revealed) return;
    const dismiss = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setRevealed(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [revealed]);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null,
  );
  const tasks = Object.values(sessions);
  const session =
    (selectedId && sessions[selectedId]) || tasks.find((s) => s.approvals.length) || tasks[0];
  const companion = session
    ? settings.personas.find((p) => p.id === session.conversation.personaId) || persona
    : persona;
  const state = session?.state || 'idle';
  const working = !!session;
  const activity = session?.conversation.messages
    .flatMap((m) => m.tools || [])
    .findLast((t) => t.status === 'running')?.name;
  const status = session?.approvals.length
    ? '有操作等待你确认'
    : activity
      ? labels[activity] || '正在执行任务'
      : session
        ? '正在思考'
        : '随时陪你开始';
  useEffect(() => {
    const fit = () => {
      const box = host.current?.getBoundingClientRect();
      if (box) setPosition((p) => clamp(p, box.width, box.height));
    };
    fit();
    window.addEventListener('resize', fit);
    const observer = new ResizeObserver(fit);
    if (host.current) observer.observe(host.current);
    return () => {
      window.removeEventListener('resize', fit);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('livra:companion-position', JSON.stringify(position));
    } catch {}
  }, [position]);
  useEffect(() => {
    if (gesture.key === 'reset') return;
    const timer = setTimeout(() => setGesture({ id: Date.now(), key: 'reset' }), 4500);
    return () => clearTimeout(timer);
  }, [gesture]);
  const react = (key: string) => {
    if (!working) setGesture({ id: Date.now(), key });
  };
  return (
    <aside
      ref={host}
      className={
        'companion-dock' + (revealed ? ' is-revealed' : '') + (dragging ? ' is-dragging' : '')
      }
      style={{ left: position.x, top: position.y }}
      aria-label="随行伙伴"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setRevealed(false);
      }}
    >
      <div
        className="companion-dock-avatar"
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest('button')) return;
          suppressClick.current = false;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            left: position.x,
            top: position.y,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !host.current) return;
          if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
          d.moved = true;
          setDragging(true);
          const box = host.current.getBoundingClientRect();
          setPosition(
            clamp(
              { x: d.left + e.clientX - d.x, y: d.top + e.clientY - d.y },
              box.width,
              box.height,
            ),
          );
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          suppressClick.current = drag.current.moved;
          if (!drag.current.moved && e.pointerType !== 'mouse') setRevealed((v) => !v);
          if (drag.current.moved) (document.activeElement as HTMLElement)?.blur();
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          suppressClick.current = true;
          setDragging(false);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
          setDragging(false);
        }}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
          }
        }}
        onKeyDown={(e) => {
          const moves: Record<string, number[]> = {
            ArrowLeft: [-16, 0],
            ArrowRight: [16, 0],
            ArrowUp: [0, -16],
            ArrowDown: [0, 16],
          };
          if (e.key === 'Escape') {
            setRevealed(false);
            (document.activeElement as HTMLElement)?.blur();
            return;
          }
          if (!moves[e.key] || !host.current) return;
          e.preventDefault();
          const [x, y] = moves[e.key],
            box = host.current.getBoundingClientRect();
          setPosition((p) => clamp({ x: p.x + x, y: p.y + y }, box.width, box.height));
        }}
        title="按住人偶拖动 · 聚焦后可用方向键移动"
      >
        <LiveAvatar
          persona={companion}
          state={state}
          mood={session?.mood || 'neutral'}
          activity={activity}
          gesture={gesture}
          reducedMotion={settings.reducedMotion}
          onTap={() => react('greet')}
        />
      </div>
      <div className="companion-chrome">
        <div className="companion-dock-bar">
          <strong>{companion.name}</strong>
          <span>{tasks.length ? `${tasks.length} 个任务` : '按住人偶可拖动'}</span>
        </div>
        <div className="companion-dock-status" role="status">
          <i data-active={working} />
          {status}
        </div>
        {tasks.length > 0 && (
          <div className="companion-task-list" aria-label="正在运行的对话">
            {tasks.map((task) => (
              <button key={task.conversation.id} onClick={() => onOpen(task.conversation.id)}>
                <span>{task.conversation.title}</span>
                <small>{task.approvals.length ? '待确认' : '运行中'}</small>
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
        )}
        <div className="companion-dock-actions">
          <button onClick={() => onOpen(session?.conversation.id)}>
            <ArrowUpRight size={14} />
            {session ? '查看对话' : '聊一聊'}
          </button>
          <IconButton
            label="人偶互动"
            onClick={() => setActions((v) => !v)}
            aria-expanded={actions}
          >
            <Sparkles size={15} />
          </IconButton>
          <IconButton label="回到对话展柜" onClick={onDock}>
            <PanelRight size={15} />
          </IconButton>
        </div>
        {actions && (
          <div className="companion-reactions" aria-label="随行互动">
            {Object.entries(companion.live.reactions)
              .filter(([, r]) => r.label)
              .map(([key, r]) => (
                <button key={key} disabled={working} onClick={() => react(key)}>
                  {r.label}
                </button>
              ))}
            {!Object.values(companion.live.reactions).some((r) => r.label) && (
              <button disabled={working} onClick={() => react('greet')}>
                打个招呼
              </button>
            )}
            <button disabled={working} onClick={() => react('reset')}>
              恢复表情
            </button>
            {working && <small>任务完成后可互动</small>}
          </div>
        )}
      </div>
    </aside>
  );
}
