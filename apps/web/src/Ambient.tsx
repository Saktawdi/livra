import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { Settings } from '@livra/shared';

export function Ambient({ settings }: { settings: Settings }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const a = settings.appearance;
  useEffect(() => {
    const canvas = ref.current,
      ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frame = 0,
      tick = 0,
      w = 0,
      h = 0;
    const motion = a.design?.motion;
    const effect =
      motion?.effect || (a.skin === 'orbit' ? 'stars' : a.skin === 'veil' ? 'aurora' : 'none');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const stars = Array.from({ length: motion?.density || 70 }, (_, i) => ({
      x: ((i * 73.13) % 100) / 100,
      y: ((i * 37.79) % 100) / 100,
      r: 0.5 + (i % 3) * 0.45,
    }));
    const resize = () => {
      w = innerWidth;
      h = innerHeight;
      const d = Math.min(devicePixelRatio, 2);
      canvas.width = w * d;
      canvas.height = h * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      draw();
    };
    const animate = a.animation && !settings.reducedMotion && effect !== 'none';
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (effect === 'none') return;
      const dark =
        settings.theme === 'dark' ||
        (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      const x = w * 0.7 + Math.sin(tick * 0.0003) * w * 0.08,
        y = h * 0.35 + Math.cos(tick * 0.0002) * h * 0.12;
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(w, h) * 0.65);
      g.addColorStop(
        0,
        motion
          ? motion.color + (effect === 'aurora' ? '40' : '20')
          : dark
            ? '#5573bf20'
            : '#99b9cb30',
      );
      g.addColorStop(0.5, motion ? motion.color + '12' : dark ? '#485ba10d' : '#c4b4d918');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      if (effect === 'grid') {
        ctx.strokeStyle = (motion?.color || '#88bfff') + '18';
        const spacing = 110 - (motion?.density || 60) * 0.7;
        const drift = (tick * 0.004) % spacing;
        ctx.beginPath();
        for (let x = -spacing + drift; x < w; x += spacing) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        }
        for (let y = -spacing + drift; y < h; y += spacing) {
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
        ctx.stroke();
      }
      if (effect === 'stars') {
        stars.forEach((s, i) => {
          ctx.globalAlpha = (dark ? 0.32 : 0.18) + (Math.sin(tick * 0.001 + i) + 1) * 0.12;
          ctx.fillStyle = motion?.color || (dark ? '#bdcff4' : '#667ba3');
          ctx.beginPath();
          ctx.arc(s.x * w, (s.y * h + tick * 0.002 * ((i % 3) + 1)) % h, s.r, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        ctx.strokeStyle = dark ? '#9bb9ef0d' : '#6687b00c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(w * 0.75, h * 0.5, w * 0.37, h * 0.36, -0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    const run = () => {
      tick += 16 * (motion?.speed || 1);
      draw();
      frame = requestAnimationFrame(run);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && animate && !reduced.matches) frame = requestAnimationFrame(run);
      else draw();
    };
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', resume);
    reduced.addEventListener('change', resume);
    resize();
    resume();
    addEventListener('resize', resize);
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelAnimationFrame(frame);
      scheme.removeEventListener('change', resume);
      reduced.removeEventListener('change', resume);
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [a.skin, a.animation, a.design, settings.reducedMotion, settings.theme]);
  return (
    <div className="ambient" aria-hidden="true">
      <div
        className="ambient-image"
        style={
          {
            backgroundImage:
              a.backgroundImage &&
              (/^https:\/\//.test(a.backgroundImage) || a.backgroundImage.startsWith('data:image/'))
                ? `url(${JSON.stringify(a.backgroundImage)})`
                : undefined,
            opacity: a.backgroundOpacity,
            filter: `blur(${a.backgroundBlur}px)`,
            backgroundPosition: a.backgroundPosition,
          } as CSSProperties
        }
      />
      <canvas ref={ref} />
    </div>
  );
}
