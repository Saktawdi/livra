import { useState } from 'react';
import { Play, Square, Volume2 } from 'lucide-react';
import { speechEngine, type Settings } from '@livra/shared';
import { Button, Field, Section, Select, Toggle } from './ui';
import { ModelDefault } from './ModelDefault';
import { VitsVoices } from './VitsVoices';
import { useVoice } from './useVoice';
import type { Notify } from './App';
import './voice.css';

export function VoiceSettings({
  draft,
  patch,
  notify,
}: {
  draft: Settings;
  patch: (data: Partial<Settings>) => void;
  notify: Notify;
}) {
  const engine = speechEngine(draft);
  const [personaId, setPersonaId] = useState(draft.personas[0]?.id || '');
  const persona = draft.personas.find((p) => p.id === personaId) || draft.personas[0];
  const [sample, setSample] = useState(
    '已经把方案整理好了。\n\n## 结论\n先做最小可用版本，验证后再完善。关键是保留你的风格，让操作更轻松。\n\n```js\nconsole.log("这段代码不应该读出来");\n```\n详细说明见 https://example.com。下一步可以从声音设置开始。',
  );
  const voice = useVoice(draft, persona, notify);
  const provider = draft.providers.find(
    (p) => p.id === draft.speechProvider && p.kind === 'speech',
  );
  return (
    <>
      <Section title="说话的方式" description="把完整回复留在对话里，把适合听的部分交给声音。">
        <Toggle
          label="自动朗读回复"
          description="本轮回复完成后开始；首次播放可能需要手动点击。"
          checked={draft.autoSpeak}
          onChange={(value) => patch({ autoSpeak: value })}
        />
        <div className="voice-mode-options" role="group" aria-label="朗读方式">
          {(
            [
              ['summary', '总结朗读', '独立模型提炼本轮内容，按人设自然表达'],
              ['direct', '纯朗读', '去除代码和链接后，直接朗读原文'],
            ] as const
          ).map(([value, title, description]) => (
            <button
              key={value}
              className={draft.speechMode === value ? 'active' : ''}
              aria-pressed={draft.speechMode === value}
              onClick={() => patch({ speechMode: value })}
            >
              <strong>
                {title}
                {value === 'summary' && <small>默认</small>}
              </strong>
              <span>{description}</span>
            </button>
          ))}
        </div>
        {draft.speechMode === 'summary' && (
          <div className="voice-summary-settings">
            <ModelDefault
              label="独立总结模型"
              kind="chat"
              draft={draft}
              providerId={draft.speechSummaryProvider}
              model={draft.speechSummaryModel}
              onChange={(id, model) =>
                patch({ speechSummaryProvider: id, speechSummaryModel: model })
              }
            />
            <p className="setting-note">
              建议选择响应快的小模型。此处独立于对话模型；使用所选连接的额度。新连接请先在「模型连接」保存。
            </p>
            {(!draft.speechSummaryProvider || !draft.speechSummaryModel) && (
              <p className="info-box">
                尚未配置总结模型：先使用简短摘读。选定模型后，会结合当前人偶设定改写为口语。
              </p>
            )}
            <Field
              label={`朗读稿上限 · ${draft.speechSummaryLength} 字符`}
              hint="通常一到三句话；先提炼，再按完整句子控制长度。"
            >
              <input
                type="range"
                min="60"
                max="240"
                step="10"
                value={draft.speechSummaryLength}
                onChange={(e) => patch({ speechSummaryLength: Number(e.target.value) })}
              />
            </Field>
            <Field label="口语风格补充" hint="自动使用当前人偶的人设，可再补充表达偏好。">
              <textarea
                rows={2}
                maxLength={1000}
                value={draft.speechSummaryStyle}
                onChange={(e) => patch({ speechSummaryStyle: e.target.value })}
                placeholder="例如：像朋友聊天，先说结论，带一点轻松的幽默。"
              />
            </Field>
          </div>
        )}
      </Section>
      <Section
        title="声音来源"
        description="VITS 公共服务无需密钥；Fish 与其他 TTS 使用你自己的连接。"
      >
        <Field label="语音引擎">
          <Select
            aria-label="语音引擎"
            value={engine}
            onChange={(value) => patch({ speechEngine: value as Settings['speechEngine'] })}
            options={[
              { value: 'vits', label: 'VITS · 公共音色库', description: '默认 · 无需密钥' },
              { value: 'browser', label: '浏览器朗读', description: '使用设备提供的声音' },
              { value: 'custom', label: '自配 TTS', description: 'Fish Audio / OpenAI 兼容' },
            ]}
          />
        </Field>
        {engine === 'vits' && (
          <>
            <Field label="VITS 模型">
              <Select
                value={draft.speechVitsModel}
                onChange={(value) =>
                  patch({
                    speechVitsModel: value as Settings['speechVitsModel'],
                    speechVitsVoice: '',
                  })
                }
                options={[
                  {
                    value: 'trilingual',
                    label: '中日英三语',
                    description: 'Umamusume / 原神等角色',
                  },
                  { value: 'japanese', label: '日语', description: '日语专用模型' },
                ]}
              />
            </Field>
            <VitsVoices
              model={draft.speechVitsModel}
              value={draft.speechVitsVoice}
              onChange={(value) => patch({ speechVitsVoice: value })}
            />
            <p className="setting-note">
              来自 Plachta / VITS-Umamusume。公共 Space
              可能排队或休眠；长文本会分段合成。日语模型请使用日语稿件。
            </p>
          </>
        )}
        {engine === 'custom' && (
          <>
            <ModelDefault
              label="TTS 模型"
              kind="speech"
              draft={draft}
              providerId={draft.speechProvider}
              model={draft.speechModel}
              onChange={(id, model) => patch({ speechProvider: id, speechModel: model })}
            />
            {!provider && <p className="info-box">请先在「模型连接」添加并保存语音服务。</p>}
          </>
        )}
        {engine !== 'vits' && (
          <Field
            label="默认音色"
            hint={
              provider?.protocol === 'fish' && engine === 'custom'
                ? 'Fish reference_id；留空使用服务默认。'
                : '服务的 voice ID，或浏览器声音名称。'
            }
          >
            <input
              value={draft.speechVoice}
              onChange={(e) => patch({ speechVoice: e.target.value })}
              placeholder="留空使用默认声音"
            />
          </Field>
        )}
        <div className="form-grid">
          <Field label="朗读语言" hint="auto 跟随稿件；可填 zh-CN、en、ja。">
            <input
              value={draft.speechLanguage}
              onChange={(e) => patch({ speechLanguage: e.target.value })}
            />
          </Field>
          <Field label={`语速 · ${draft.speechSpeed.toFixed(1)}×`}>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={draft.speechSpeed}
              onChange={(e) => patch({ speechSpeed: Number(e.target.value) })}
            />
          </Field>
          {engine === 'custom' && provider?.protocol === 'fish' && (
            <Field label="Fish 合成偏好">
              <Select
                value={draft.speechLatency}
                onChange={(value) => patch({ speechLatency: value as Settings['speechLatency'] })}
                options={[
                  { value: 'balanced', label: '均衡 · 低延迟' },
                  { value: 'normal', label: '音质优先' },
                ]}
              />
            </Field>
          )}
        </div>
        <p className="setting-note">
          人偶卡的专属音色和语言优先。试听会使用所选人偶的音色，留空则使用这里的默认值。
        </p>
      </Section>
      <Section title="听听看" description="使用当前草稿设置，先看朗读稿，再听这位伙伴如何表达。">
        <Field label="试听人偶">
          <Select
            value={persona.id}
            onChange={setPersonaId}
            options={draft.personas.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field label="本轮回复示例">
          <textarea
            rows={5}
            maxLength={100_000}
            value={sample}
            onChange={(e) => setSample(e.target.value)}
          />
        </Field>
        <Button
          onClick={() => void voice.speak(sample, true)}
          disabled={!sample.trim() || (engine === 'custom' && !provider)}
        >
          {voice.preparing || voice.speaking ? <Square size={15} /> : <Play size={15} />}
          {voice.preparing
            ? `${voice.stage} · 点击取消`
            : voice.speaking
              ? '停止试听'
              : '试听当前设置'}
        </Button>
        {voice.script && (
          <div className="voice-script" role="status">
            <span>
              <Volume2 size={14} />
              实际朗读稿 ·{' '}
              {{ model: '模型改写', extract: '简短摘读', direct: '纯朗读' }[voice.script.source]}
            </span>
            <p>{voice.script.text}</p>
            {voice.script.warning && <small>{voice.script.warning}</small>}
          </div>
        )}
      </Section>
      <Section title="语音输入">
        <p className="muted">输入框的麦克风使用浏览器语音识别，输入语言跟随界面语言。</p>
      </Section>
    </>
  );
}
