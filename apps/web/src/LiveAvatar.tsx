import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { LiveState, Mood, Persona } from '@livra/shared';
import { IconButton } from './ui';
import { loadLive2D, waitForAvatarSize, liveModelSource } from './live2d-runtime';
export function LiveAvatar({
  persona,
  state = 'idle',
  mood = 'neutral',
  reducedMotion = false,
  onTap,
  compact = false,
  audioLevel,
  paused = false,
  onStatus,
  activity,
  gesture,
  completed = false,
}: {
  persona: Persona;
  state?: LiveState;
  mood?: Mood;
  reducedMotion?: boolean;
  onTap?: () => void;
  compact?: boolean;
  audioLevel?: { current: number | undefined };
  paused?: boolean;
  onStatus?: (status: string) => void;
  activity?: string;
  gesture?: { id: number; key: string };
  completed?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    modelRef = useRef<any>(null),
    fitRef = useRef<(() => void) | null>(null),
    stateRef = useRef({ state, mood, reducedMotion, persona, audioLevel, onTap, compact });
  stateRef.current = { state, mood, reducedMotion, persona, audioLevel, onTap, compact };
  const [status, setStatus] = useState('loading'),
    [retry, setRetry] = useState(0);
  const [loadError, setLoadError] = useState('');
  const recoveries = useRef(0);
  useEffect(() => {
    recoveries.current = 0;
  }, [persona.live.modelUrl, persona.live.coreUrl]);
  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);
  const appRef = useRef<any>(null);
  useEffect(() => {
    let disposed = false;
    let app: any;
    let observer: ResizeObserver | undefined;
    let model: any;
    let canvas: HTMLCanvasElement | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const recover = () => {
      if (disposed) return;
      clearTimeout(recoveryTimer);
      if (recoveries.current++ < 2) setRetry((value) => value + 1);
      else {
        setLoadError('图形渲染暂不可用，请重新加载人偶');
        setStatus('error');
      }
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      if (disposed) return;
      app?.stop();
      setStatus('recovering');
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(recover, 1200);
    };
    setStatus('loading');
    setLoadError('');
    async function setup() {
      if (!persona.live.modelUrl) {
        setStatus('symbol');
        return;
      }
      const PIXI = await loadLive2D(persona.live.coreUrl);
      if (disposed) return;
      const { Live2DModel } = (window as any).PIXI.live2d;
      const container = host.current;
      if (disposed || !container?.isConnected) return;
      await waitForAvatarSize(container, abort.signal);
      if (disposed) return;
      app = new PIXI.Application({
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        resizeTo: container,
        autoStart: false,
        sharedTicker: false,
      });
      appRef.current = app;
      app.ticker.maxFPS = 30;
      canvas = app.view as HTMLCanvasElement;
      canvas.addEventListener('webglcontextlost', contextLost);
      canvas.addEventListener('webglcontextrestored', recover);
      container.appendChild(canvas);
      const source = await liveModelSource(persona.live.modelUrl, abort.signal);
      if (disposed) return;
      const loadingModel = Live2DModel.from(source, {
        autoInteract: false,
        idleMotionGroup: persona.live.idleMotion,
        motionPreload: 'IDLE' as any,
        autoUpdate: false,
      });
      let expired = false;
      void loadingModel.then(
        (loaded: any) => {
          if (expired || disposed) loaded.destroy({ texture: false, baseTexture: false });
        },
        () => {},
      );
      let timeout: ReturnType<typeof setTimeout>;
      try {
        model = await Promise.race([
          loadingModel,
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              expired = true;
              reject(Error('人偶资源加载超时，请重试'));
            }, 30000);
          }),
        ]);
      } finally {
        clearTimeout(timeout!);
      }
      if (disposed || host.current !== container || !container.isConnected) {
        if (!model.destroyed) model.destroy({ texture: false, baseTexture: false });
        return;
      }
      modelRef.current = model;
      app.stage.addChild(model);
      app.ticker.add(() => {
        if (!disposed && !model.destroyed) model.update(app.ticker.deltaMS);
      });
      model.anchor.set(0.5, 1);
      const fit = () => {
        if (!host.current || disposed) return;
        const { width, height } = host.current.getBoundingClientRect();
        if (width <= 0 || height <= 0 || app.renderer.gl?.isContextLost()) return;
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
          width * (0.5 + live.offsetX),
          crop
            ? height * (0.03 + live.offsetY) + model.internalModel.height * scale
            : height * (0.99 + live.offsetY),
        );
        model.update(16);
        app.render();
      };
      fitRef.current = fit;
      fit();
      observer = new ResizeObserver(fit);
      observer.observe(container);
      model.internalModel.on('beforeModelUpdate', () => {
        const s = stateRef.current;
        const core = model.internalModel.coreModel;
        const parameter = (name: string, value: number) => {
          if (core.setParameterValueById) core.setParameterValueById(name, value);
          else
            core.setParamFloat?.(
              name
                .replace(/^Param/, 'PARAM_')
                .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
                .replace(/([a-z])([A-Z])/g, '$1_$2')
                .toUpperCase(),
              value,
            );
        };
        const mouth =
          s.state === 'speaking'
            ? (s.audioLevel?.current ??
              0.18 + Math.max(0, Math.sin(performance.now() * 0.023)) * 0.55)
            : 0;
        parameter('ParamMouthOpenY', mouth);
        if (!s.persona.live.expressions[s.mood]) {
          parameter(
            'ParamMouthForm',
            s.mood === 'happy' || s.mood === 'excited' ? 0.65 : s.mood === 'concerned' ? -0.25 : 0,
          );
          if (s.mood === 'thinking') parameter('ParamAngleZ', 6);
          if (s.mood === 'happy' || s.mood === 'excited') {
            parameter('ParamEyeLSmile', 0.4);
            parameter('ParamEyeRSmile', 0.4);
          }
        }
      });
      model.on('hit', () => {
        if (
          ['thinking', 'working'].includes(stateRef.current.state) ||
          stateRef.current.reducedMotion
        )
          return;
        model.motion(stateRef.current.persona.live.tapMotion).catch(() => {});
      });
      model.update(16);
      app.render();
      setStatus('ready');
    }
    setup().catch((error) => {
      if (!disposed) {
        console.warn('Live2D:', error.message);
        app?.stop();
        setLoadError(error.message || '人偶资源未能加载');
        setStatus('error');
      }
    });
    // Pixi caches model textures by URL; other visible portraits may share them.
    return () => {
      disposed = true;
      abort.abort();
      clearTimeout(recoveryTimer);
      canvas?.removeEventListener('webglcontextlost', contextLost);
      canvas?.removeEventListener('webglcontextrestored', recover);
      observer?.disconnect();
      modelRef.current = null;
      fitRef.current = null;
      appRef.current = null;
      if (app) app.destroy(true, { children: true, texture: false, baseTexture: false });
    };
  }, [persona.live.modelUrl, persona.live.coreUrl, retry]);
  const previousState = useRef(state);
  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    const wasWorking = ['thinking', 'working'].includes(previousState.current);
    previousState.current = state;
    const working = ['thinking', 'working', 'error'].includes(state);
    const reaction = working
      ? persona.live.reactions[activity || state] || persona.live.reactions[state]
      : state === 'idle' && wasWorking && completed
        ? persona.live.reactions.celebrate
        : gesture && gesture.key !== 'reset'
          ? persona.live.reactions[gesture.key]
          : undefined;
    const expression = reaction?.expression || persona.live.expressions[mood];
    if (expression) model.expression(expression).catch(() => {});
    else model.internalModel.motionManager.expressionManager?.resetExpression?.();
    if (reaction?.motion && !reducedMotion) model.motion(reaction.motion).catch(() => {});
  }, [
    mood,
    state,
    activity,
    gesture?.id,
    status,
    persona.live.expressions,
    persona.live.reactions,
    reducedMotion,
    completed,
  ]);
  useEffect(() => {
    fitRef.current?.();
  }, [persona.live.scale, persona.live.offsetX, persona.live.offsetY, compact]);
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      if (!appRef.current || !modelRef.current) return;
      if (status !== 'ready') {
        appRef.current.stop();
        return;
      }
      const run = !paused && !document.hidden && status === 'ready';
      modelRef.current.autoUpdate = false;
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
      data-live-status={status}
      style={{ '--persona-color': persona.color } as React.CSSProperties}
    >
      <div
        className="live-canvas"
        ref={host}
        role={onTap ? 'button' : 'img'}
        tabIndex={onTap ? 0 : undefined}
        aria-label={onTap ? `与${persona.name}互动` : `${persona.name} Live2D 人偶`}
        onKeyDown={(e) => {
          if (onTap && ['Enter', ' '].includes(e.key)) {
            e.preventDefault();
            if (!['thinking', 'working'].includes(state)) onTap();
          }
        }}
        onPointerMove={(e) => {
          if (!persona.live.followCursor || reducedMotion) return;
          modelRef.current?.focus(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        }}
        onPointerLeave={() => {
          modelRef.current?.internalModel.focusController?.focus(0, 0);
        }}
        onClick={(e) => {
          if (['thinking', 'working'].includes(state)) return;
          if (modelRef.current) {
            const rect = e.currentTarget.getBoundingClientRect();
            modelRef.current.tap(e.clientX - rect.left, e.clientY - rect.top);
          }
          onTap?.();
        }}
      />
      {status !== 'ready' && (
        <div className="live-fallback" role="status">
          <div
            className={
              'avatar-spark ' + (['loading', 'recovering'].includes(status) ? 'breathe' : '')
            }
          >
            {persona.name.slice(0, 1)}
          </div>
          {status === 'loading' || status === 'recovering' ? (
            <span>{status === 'recovering' ? '正在恢复人偶…' : '正在加载人偶…'}</span>
          ) : status === 'error' ? (
            <>
              <span title={loadError}>人偶暂时未能加载</span>
              <IconButton
                label="重新加载人偶"
                onClick={() => {
                  recoveries.current = 0;
                  setRetry((v) => v + 1);
                }}
              >
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
