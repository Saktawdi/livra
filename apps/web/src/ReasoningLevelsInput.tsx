// Ported from lumen-utools.
import { useEffect, useRef, useState } from 'react';
import { parseReasoningLevels } from './reasoning-levels';

export default function ReasoningLevelsInput({
  value = [],
  onChange,
}: {
  value?: string[];
  onChange: (levels: string[]) => void;
}) {
  const levels = parseReasoningLevels(value);
  const signature = JSON.stringify(levels);
  const emitted = useRef(signature);
  const [draft, setDraft] = useState(() => levels.join(', '));
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);

  // Sync catalog restores, while keeping the user's raw separators and caret during typing.
  useEffect(() => {
    if (signature !== emitted.current) {
      emitted.current = signature;
      setDraft((JSON.parse(signature) as string[]).join(', '));
    }
  }, [signature]);

  const edit = (text: string) => {
    setDraft(text);
    const next = parseReasoningLevels(text);
    const nextSignature = JSON.stringify(next);
    if (nextSignature !== emitted.current) {
      emitted.current = nextSignature;
      onChange(next);
    }
  };

  return (
    <input
      ref={input}
      aria-label="支持的推理档位"
      value={draft}
      placeholder="low, medium, high"
      onChange={(e) => edit(e.target.value)}
      onPaste={(e) => {
        const text = e.clipboardData.getData('text/plain');
        if (!/[\r\n]/.test(text)) return;
        e.preventDefault();
        const start = e.currentTarget.selectionStart ?? draft.length;
        const end = e.currentTarget.selectionEnd ?? start;
        const pasted = text.replace(/\r\n|\r|\n/g, ', ');
        edit(`${draft.slice(0, start)}${pasted}${draft.slice(end)}`);
        requestAnimationFrame(() =>
          input.current?.setSelectionRange(start + pasted.length, start + pasted.length),
        );
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(e) => {
        if (
          e.key !== 'Enter' ||
          composing.current ||
          e.nativeEvent.isComposing ||
          e.keyCode === 229
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        const start = e.currentTarget.selectionStart ?? draft.length;
        const end = e.currentTarget.selectionEnd ?? start;
        // Enter creates a separator at the caret, including when editing an existing level.
        if (!draft.slice(0, start).trim()) return;
        const prefix = draft.slice(0, start).replace(/[,，;；、\s]+$/, '');
        const next = `${prefix}, ${draft.slice(end).replace(/^\s+/, '')}`;
        edit(next);
        requestAnimationFrame(() =>
          input.current?.setSelectionRange(prefix.length + 2, prefix.length + 2),
        );
      }}
      onBlur={() => setDraft(parseReasoningLevels(draft).join(', '))}
    />
  );
}
