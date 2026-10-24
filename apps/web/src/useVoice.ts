import { useEffect, useRef, useState } from 'react';
import type { Persona, Settings } from '@livra/shared';
import { API } from './api';
import type { Notify } from './App';

export function useVoice(settings: Settings, persona: Persona, notify: Notify) {
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
  }
  useEffect(() => {
    stop();
    return stop;
  }, [persona.id]);
  async function speak(text: string) {
    const wasPlaying = active.current;
    stop();
    if (wasPlaying) return;
    const clean = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[*#_`>]/g, '')
      .trim()
      .slice(0, 4000);
    if (!clean) return;
    const id = generation.current;
    active.current = true;
    setPreparing(true);
    const language =
      persona.voiceLanguage && persona.voiceLanguage !== 'auto'
        ? persona.voiceLanguage
        : settings.speechLanguage;
    const finish = () => {
      if (id === generation.current) stop();
    };
    if (settings.speechProvider) {
      level.current = 0;
      // Start the audio context during the user's gesture; read amplitudes only locally.
      try {
        context.current = new AudioContext();
        void context.current.resume().catch(() => {});
      } catch {}
      const controller = new AbortController();
      request.current = controller;
      try {
        const response = await fetch(API + '/api/speech', {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Livra-Client': 'web' },
          body: JSON.stringify({ input: clean, voice: persona.voice, language }),
        });
        if (!response.ok) throw Error((await response.json()).error);
        const blob = await response.blob();
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
      } catch (error) {
        if (id === generation.current) {
          const cancelled = controller.signal.aborted;
          finish();
          if (!cancelled) notify((error as Error).message, 'error');
        }
      }
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
  }
  return { speaking, preparing, level, speak, stop };
}
