import { useEffect, useRef, useState } from 'react';
import type { AgentEvent, Attachment, Conversation, LiveState, Mood } from '@livra/shared';
import { api, post, streamRun } from './api';
import type { Approval, Notify } from './App';

export type ConversationSession = {
  conversation: Conversation;
  state: LiveState;
  mood: Mood;
  approvals: Approval[];
};
type Input = {
  content: string;
  attachments: Attachment[];
  providerId: string;
  model: string;
  reasoning: string;
};

export function useConversationRuns(callbacks: {
  notify: Notify;
  onComplete: (conversation: Conversation) => Promise<void>;
  onArtifact: () => void;
}) {
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const [sessions, setSessions] = useState<Record<string, ConversationSession>>({});
  const current = useRef<Record<string, ConversationSession>>({});
  const controllers = useRef(new Map<string, { id: string; controller: AbortController }>());
  useEffect(
    () => () => {
      for (const run of controllers.current.values()) run.controller.abort();
    },
    [],
  );
  function change(id: string, update: (session: ConversationSession) => ConversationSession) {
    if (!current.current[id]) return;
    current.current = { ...current.current, [id]: update(current.current[id]) };
    setSessions(current.current);
  }
  async function start(conversation: Conversation, input: Input) {
    const id = conversation.id;
    if (controllers.current.has(id)) return false;
    const run = { id: '', controller: new AbortController() };
    controllers.current.set(id, run);
    current.current = {
      ...current.current,
      [id]: {
        conversation: {
          ...conversation,
          title: conversation.messages.length
            ? conversation.title
            : input.content.slice(0, 48) || input.attachments[0]?.name || '新对话',
          messages: [
            ...conversation.messages,
            {
              id: crypto.randomUUID(),
              role: 'user',
              content: input.content,
              attachments: input.attachments,
              created: Date.now(),
            },
          ],
        },
        state: 'thinking',
        mood: 'thinking',
        approvals: [],
      },
    };
    setSessions(current.current);
    let assistantId = '',
      accepted = false;
    const patchMessage = (
      update: (message: Conversation['messages'][number]) => Conversation['messages'][number],
    ) => {
      change(id, (s) => ({
        ...s,
        conversation: {
          ...s.conversation,
          messages: s.conversation.messages.map((m) => (m.id === assistantId ? update(m) : m)),
        },
      }));
    };
    try {
      await streamRun(
        { conversationId: id, ...input },
        run.controller.signal,
        (event: AgentEvent) => {
          if (event.type === 'start') {
            accepted = true;
            run.id = event.runId;
            assistantId = event.message.id;
            change(id, (s) => ({
              ...s,
              conversation: {
                ...s.conversation,
                messages: [...s.conversation.messages, event.message],
              },
            }));
          } else if (event.type === 'delta' || event.type === 'reasoning') {
            const key = event.type === 'delta' ? 'content' : 'reasoning';
            patchMessage((m) => ({
              ...m,
              [key]: (m[key] || '') + event.text,
              generation: event.generation,
            }));
            change(id, (s) => ({ ...s, state: 'thinking' }));
          } else if (event.type === 'tool-start') {
            change(id, (s) => ({ ...s, state: 'working' }));
            patchMessage((m) => ({ ...m, tools: [...(m.tools || []), event.tool] }));
          } else if (event.type === 'tool-end') {
            change(id, (s) => ({ ...s, state: 'thinking' }));
            patchMessage((m) => ({
              ...m,
              tools: m.tools?.map((t) => (t.id === event.tool.id ? event.tool : t)),
            }));
          } else if (event.type === 'emotion') change(id, (s) => ({ ...s, mood: event.mood }));
          else if (event.type === 'approval')
            change(id, (s) => ({
              ...s,
              approvals: [
                ...s.approvals,
                { id: event.id, runId: event.runId, name: event.name, args: event.args },
              ],
            }));
          else if (event.type === 'artifact') latest.current.onArtifact();
          else if (event.type === 'usage')
            patchMessage((m) => ({ ...m, usage: event.usage, contextTokens: event.contextTokens }));
          else if (event.type === 'metrics')
            patchMessage((m) => ({
              ...m,
              generation: event.generation,
              contextTokens: event.contextTokens,
            }));
          else if (event.type === 'error' && !event.cancelled) {
            change(id, (s) => ({ ...s, state: 'error' }));
            latest.current.notify(event.message, 'error');
          }
        },
      );
    } catch (error) {
      if (!run.controller.signal.aborted) latest.current.notify((error as Error).message, 'error');
    } finally {
      let saved = current.current[id]?.conversation || conversation;
      try {
        saved = await api<Conversation>('/conversations/' + id);
      } catch {}
      try {
        await latest.current.onComplete(saved);
      } catch (error) {
        latest.current.notify((error as Error).message, 'error');
      } finally {
        controllers.current.delete(id);
        const next = { ...current.current };
        delete next[id];
        current.current = next;
        setSessions(next);
      }
    }
    return accepted;
  }
  async function stop(id: string | null) {
    const run = id ? controllers.current.get(id) : undefined;
    if (run?.id) await post('/runs/' + run.id + '/stop', {}).catch(() => {});
    run?.controller.abort();
  }
  async function approve(item: Approval, allow: boolean) {
    try {
      await post(`/runs/${item.runId}/approvals/${item.id}`, { allow });
      for (const id of Object.keys(current.current))
        change(id, (s) => ({ ...s, approvals: s.approvals.filter((a) => a.id !== item.id) }));
    } catch (error) {
      latest.current.notify((error as Error).message, 'error');
    }
  }
  return { sessions, start, stop, approve };
}
