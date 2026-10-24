import { Gauge } from 'lucide-react';
import type { Attachment, Conversation, Persona, Settings } from '@livra/shared';
import {
  estimateAttachments,
  estimateMessages,
  estimateTextTokens,
  formatTokens,
} from '../../../packages/shared/src/token-metrics';

export function ComposerMetrics({
  conversation,
  persona,
  settings,
  provider,
  model,
  draft,
  attachments,
  busy,
}: {
  conversation: Conversation | null;
  persona: Persona;
  settings: Settings;
  provider: string;
  model: string;
  draft: string;
  attachments: Attachment[];
  busy: boolean;
}) {
  const messages = conversation?.messages || [],
    last = messages.findLast((m) => m.role === 'assistant');
  const sameModel = last?.providerId === provider && last.model === model;
  const measured = sameModel && last.contextTokens !== undefined && !busy;
  const tokens =
    (measured
      ? last.contextTokens!
      : estimateMessages(messages) + estimateTextTokens(persona.systemPrompt)) +
    estimateTextTokens(draft) +
    estimateAttachments(attachments);
  const estimated = !measured || !!draft || !!attachments.length;
  const limit = settings.providers.find((p) => p.id === provider)?.contextWindows?.[model];
  const percent = limit ? Math.min(100, (tokens / limit) * 100) : 0;
  const g = sameModel ? last?.generation : undefined;
  const rate = g && g.durationMs >= 100 ? g.outputTokens / (g.durationMs / 1000) : 0;
  return (
    <div className="composer-metrics" aria-label="对话统计">
      <span
        className={'composer-metric ' + (percent >= 90 ? 'near-limit' : '')}
        title={`${estimated ? '估算' : '供应商上报'}上下文：${tokens.toLocaleString()} tokens${limit ? ' / ' + limit.toLocaleString() : '；模型未提供容量上限'}。估算包含附件近似值。`}
      >
        <svg className="context-ring" width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="7.5"
            fill="none"
            stroke="currentColor"
            strokeOpacity=".2"
            strokeWidth="2"
          />
          {limit && (
            <circle
              cx="10"
              cy="10"
              r="7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              pathLength="100"
              strokeDasharray={`${percent} 100`}
              transform="rotate(-90 10 10)"
            />
          )}
        </svg>
        <span>
          {estimated ? '≈ ' : ''}
          {formatTokens(tokens)}
          {limit ? ' / ' + formatTokens(limit) : ''} <span className="metric-unit">tok</span>
        </span>
      </span>
      <i className="metric-separator" />
      <span
        className={'composer-metric ' + (busy && rate ? 'metric-live' : '')}
        title={
          g
            ? `${g.estimated ? '估算' : '上报'}输出 token / 文本流时间，包含思考，不计工具执行和首字等待。过短的样本不计入。`
            : '生成回复后显示输出速率。'
        }
      >
        <Gauge size={14} />
        <span>
          {rate ? (g?.estimated ? '≈ ' : '') + rate.toFixed(1) : '—'}{' '}
          <span className="metric-unit">tok/s</span>
        </span>
      </span>
    </div>
  );
}
