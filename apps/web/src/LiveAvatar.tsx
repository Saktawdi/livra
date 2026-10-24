import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { LiveState, Mood, Persona } from '@livra/shared';
import { IconButton } from './ui';

const scripts = new Map<string, Promise<void>>();
function loadScript(url: string) {
  if (!scripts.has(url))
    scripts.set(
      url,
      new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () => {
          scripts.delete(url);
          script.remove();
          reject(Error('Live2D Core 未能加载'));
        };
        document.head.appendChild(script);
      }),
    );
  return scripts.get(url)!;
}
export function LiveAvatar({
  persona,
  state = 'idle',
  mood = 'neutral',
  reducedMotion = false,
  onTap,
  compact = false,
  audioLevel,
  paused = false,
}: {
  persona: Persona;
  state?: LiveState;
  mood?: Mood;
  reducedMotion?: boolean;
  onTap?: () => void;
  compact?: boolean;
  audioLevel?: { current: number | undefined };
  paused?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    modelRef = useRef<any>(null),
    fitRef = useRef<(() => void) | null>(null),
    stateRef = useRef({ state, mood, reducedMotion, persona, audioLevel, onTap, compact });
  stateRef.current = { state, mood, reducedMotion, persona, audioLevel, onTap, compact };
  const [status, setStatus] = useState('loading'),
    [retry, setRetry] = useState(0);
  const appRef = useRef<any>(null),
    pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    let disposed = false;
    let app: any;
    let observer: ResizeObserver | undefined;
    let model: any;
    setStatus('loading');
    async function setup() {
      if (!persona.live.modelUrl) {
        setStatus('symbol');
        return;
      }
      await loadScript(persona.live.coreUrl);
      if (disposed) return;
      const PIXI = await import('pixi.js');
      if (!(window as any).PIXI?.live2d) (window as any).PIXI = { ...PIXI };
      await loadScript('/vendor/pixi-live2d-display-0.4.0.min.js');
      const { Live2DModel } = (window as any).PIXI.live2d;
      if (disposed) return;
      app = new PIXI.Application({
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        resizeTo: host.current!,
      });
      appRef.current = app;
      app.ticker.maxFPS = 30;
      host.current!.appendChild(app.view as HTMLCanvasElement);
      model = await Live2DModel.from(persona.live.modelUrl, {
        autoInteract: false,
        idleMotionGroup: persona.live.idleMotion,
        motionPreload: 'IDLE' as any,
      });
      if (disposed) {
        model.destroy();
        return;
      }
      modelRef.current = model;
      app.stage.addChild(model);
      model.anchor.set(0.5, 1);
      const fit = () => {
        if (!host.current || disposed) return;
        const { width, height } = host.current.getBoundingClientRect();
        app.renderer.resize(width, height);
        const { live } = stateRef.current.persona;
        const crop = stateRef.current.compact;
        const scale =
          Math.min(
            (width * 0.97) / model.internalModel.width,
            (height * 0.94) / model.internalModel.height,
          ) *
          live.scale *
          (crop ? 1.75 : 1);
        model.scale.set(scale);
        model.position.set(
          width * 0.5,
          crop
            ? height * (0.03 + live.offsetY) + model.internalModel.height * scale
            : height * (0.99 + live.offsetY),
        );
        if (pausedRef.current) {
          model.update(16);
          app.render();
        }
      };
      fitRef.current = fit;
      fit();
      observer = new ResizeObserver(fit);
      observer.observe(host.current!);
      model.internalModel.on('beforeModelUpdate', () => {
        const s = stateRef.current;
        const core = model.internalModel.coreModel;
        const mouth =
          s.state === 'speaking'
            ? (s.audioLevel?.current ??
              0.18 + Math.max(0, Math.sin(performance.now() * 0.023)) * 0.55)
            : 0;
        core.setParameterValueById?.('ParamMouthOpenY', mouth);
        if (!s.persona.live.expressions[s.mood]) {
          core.setParameterValueById?.(
            'ParamMouthForm',
            s.mood === 'happy' || s.mood === 'excited' ? 0.65 : s.mood === 'concerned' ? -0.25 : 0,
          );
          if (s.mood === 'thinking') core.setParameterValueById?.('ParamAngleZ', 6);
          if (s.mood === 'happy' || s.mood === 'excited') {
            core.setParameterValueById?.('ParamEyeLSmile', 0.4);
            core.setParameterValueById?.('ParamEyeRSmile', 0.4);
          }
        }
      });
      model.on('hit', () => {
        model.motion(stateRef.current.persona.live.tapMotion).catch(() => {});
        stateRef.current.onTap?.();
      });
      model.update(16);
      app.render();
      setStatus('ready');
    }
    setup().catch((error) => {
      if (!disposed) {
        console.warn('Live2D:', error.message);
        setStatus('error');
      }
    });
    // Pixi caches model textures by URL; other visible portraits may share them.
    return () => {
      disposed = true;
      observer?.disconnect();
      modelRef.current = null;
      fitRef.current = null;
      appRef.current = null;
      if (app) app.destroy(true, { children: true, texture: false, baseTexture: false });
    };
  }, [persona.live.modelUrl, persona.live.coreUrl, retry]);
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    const expression = persona.live.expressions[mood];
    if (expression) model.expression(expression).catch(() => {});
    else model.internalModel.motionManager.expressionManager?.resetExpression?.();
  }, [mood, status, persona.live.expressions]);
  useEffect(() => {
    fitRef.current?.();
  }, [persona.live.scale, persona.live.offsetY, compact]);
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      if (!appRef.current || !modelRef.current) return;
      const run = !paused && !document.hidden;
      modelRef.current.autoUpdate = run;
      if (run) appRef.current.start();
      else {
        const settle = () => {
          if (!appRef.current || !modelRef.current) return;
          modelRef.current.update(16);
          appRef.current.render();
          appRef.current.stop();
        };
        settle();
        frame = requestAnimationFrame(settle);
      }
    };
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', apply);
    };
  }, [paused, status]);
  useEffect(() => {
    const model = modelRef.current;
    if (model?.internalModel?.motionManager?.groups)
      model.internalModel.motionManager.groups.idle = persona.live.idleMotion;
  }, [persona.live.idleMotion, status]);
  return (
    <div
      className={`live-avatar ${compact ? 'compact' : ''} state-${state}`}
      style={{ '--persona-color': persona.color } as React.CSSProperties}
    >
      <div
        className="live-canvas"
        ref={host}
        role="img"
        aria-label={`${persona.name} Live2D 人偶`}
        onPointerMove={(e) => {
          if (!persona.live.followCursor || reducedMotion) return;
          modelRef.current?.focus(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        }}
        onPointerLeave={() => {
          modelRef.current?.internalModel.focusController?.focus(0, 0);
        }}
        onClick={(e) => {
          if (modelRef.current) {
            const rect = e.currentTarget.getBoundingClientRect();
            modelRef.current.tap(e.clientX - rect.left, e.clientY - rect.top);
          }
        }}
      />
      {status !== 'ready' && (
        <div className="live-fallback" role="status">
          <div className={'avatar-spark ' + (status === 'loading' ? 'breathe' : '')}>
            {persona.name.slice(0, 1)}
          </div>
          {status === 'loading' ? (
            <span>正在加载人偶…</span>
          ) : status === 'error' ? (
            <>
              <span>人偶暂时未能加载</span>
              <IconButton label="重新加载人偶" onClick={() => setRetry((v) => v + 1)}>
                <RotateCcw size={16} />
              </IconButton>
            </>
          ) : (
            <span>{persona.name}</span>
          )}
        </div>
      )}
      <div className="live-ground" />
    </div>
  );
}
