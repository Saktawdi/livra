import { useEffect, useRef, useState } from 'react';
import { speechEngine, type Persona, type Settings, type SpeechScript } from '@livra/shared';
import { post } from './api';
import type { Notify } from './App';

export function useVoice(settings: Settings, persona: Persona, notify: Notify) {
  const [script, setScript] = useState<SpeechScript | null>(null);
  const [stage, setStage] = useState('');
  const [speaking, setSpeaking] = useState(false),
    [preparing, setPreparing] = useState(false);
  const level = useRef<number | undefined>(undefined),
    active = useRef(false),
    generation = useRef(0);
  const request = useRef<AbortController | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    context = useRef<AudioContext | null>(null),
    url = useRef(''),
    frame = useRef(0);
  const preferences = JSON.stringify(
    Object.entries(settings).filter(([key]) => key.startsWith('speech')),
  );
  function stop() {
    generation.current++;
    active.current = false;
    request.current?.abort();
    request.current = null;
    window.speechSynthesis?.cancel();
    audio.current?.pause();
    audio.current = null;
    cancelAnimationFrame(frame.current);
    if (context.current) void context.current.close().catch(() => {});
    context.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = '';
    level.current = undefined;
    setSpeaking(false);
    setPreparing(false);
    setStage('');
  }
  useEffect(() => {
    stop();
    setScript(null);
    return stop;
  }, [
    persona.id,
    persona.name,
    persona.systemPrompt,
    persona.voice,
    persona.vitsVoice,
    persona.voiceLanguage,
    preferences,
  ]);
  async function speak(text: string, preview = false) {
    const wasPlaying = active.current;
    stop();
    if (wasPlaying) return;
    if (!text.trim()) return;
    const id = generation.current;
    active.current = true;
    setPreparing(true);
    setScript(null);
    setStage(settings.speechMode === 'summary' ? '正在整理朗读稿' : '正在准备朗读');
    const language =
      persona.voiceLanguage && persona.voiceLanguage !== 'auto'
        ? persona.voiceLanguage
        : settings.speechLanguage;
    const finish = () => {
      if (id === generation.current) stop();
    };
    const engine = speechEngine(settings);
    const controller = new AbortController();
    request.current = controller;
    // Preview preferences are resolved against credentials in browser storage.
    const draft = preview
      ? Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith('speech')))
      : undefined;
    if (engine !== 'browser') {
      level.current = 0;
      // Start the audio context during the user's gesture; read amplitudes only locally.
      try {
        context.current = new AudioContext();
        void context.current.resume().catch(() => {});
      } catch {}
    }
    try {
      const prepared = await post<SpeechScript>(
        '/speech/prepare',
        {
          input: text.slice(0, 100_000),
          personaId: persona.id,
          draft,
          ...(preview
            ? {
                persona: {
                  name: persona.name,
                  systemPrompt: persona.systemPrompt,
                  voiceLanguage: persona.voiceLanguage,
                },
              }
            : {}),
        },
        { signal: controller.signal },
      );
      if (id !== generation.current) return;
      setScript(prepared);
      if (prepared.warning && !preview) notify(prepared.warning);
      const clean = prepared.text;
      setStage(
        engine === 'vits'
          ? 'VITS 正在排队合成'
          : engine === 'custom'
            ? '正在合成语音'
            : '正在准备播放',
      );
      if (engine !== 'browser') {
        const blob = await post<Blob>(
          '/speech',
          {
            input: clean,
            voice: engine === 'vits' ? persona.vitsVoice : persona.voice,
            language,
            draft,
          },
          { signal: controller.signal },
        );
        if (id !== generation.current) return;
        url.current = URL.createObjectURL(blob);
        const player = new Audio(url.current);
        audio.current = player;
        player.onplaying = () => {
          if (id === generation.current) {
            setPreparing(false);
            setSpeaking(true);
          }
        };
        player.onended = finish;
        player.onerror = () => {
          if (id === generation.current) {
            finish();
            notify('音频暂时无法播放，请检查语音服务输出', 'error');
          }
        };
        if (context.current) {
          try {
            const analyser = context.current.createAnalyser();
            analyser.fftSize = 256;
            context.current.createMediaElementSource(player).connect(analyser);
            analyser.connect(context.current.destination);
            const data = new Uint8Array(analyser.fftSize);
            const tick = () => {
              if (id !== generation.current) return;
              analyser.getByteTimeDomainData(data);
              const rms = Math.sqrt(
                data.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) / data.length,
              );
              level.current = (level.current || 0) * 0.35 + Math.min(1, rms * 5) * 0.65;
              frame.current = requestAnimationFrame(tick);
            };
            tick();
          } catch {
            level.current = undefined;
          }
        } else level.current = undefined;
        await player.play();
      } else if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(clean);
        utterance.lang = language && language !== 'auto' ? language : settings.locale;
        utterance.rate = settings.speechSpeed;
        const selected = window.speechSynthesis
          .getVoices()
          .find((v) => v.name === (persona.voice || settings.speechVoice));
        if (selected) utterance.voice = selected;
        utterance.onstart = () => {
          if (id === generation.current) {
            setPreparing(false);
            setSpeaking(true);
          }
        };
        utterance.onend = utterance.onerror = finish;
        window.speechSynthesis.speak(utterance);
      } else {
        finish();
        notify('当前浏览器不支持朗读，可在设置中连接语音服务', 'error');
      }
    } catch (error) {
      if (id === generation.current) {
        const cancelled = controller.signal.aborted;
        finish();
        if (!cancelled) notify((error as Error).message, 'error');
      }
    }
  }
  return { speaking, preparing, stage, script, level, speak, stop };
}
