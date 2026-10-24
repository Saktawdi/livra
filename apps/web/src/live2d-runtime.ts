const scripts = new Map<string, Promise<void>>();
let pixiRuntime: Promise<typeof import('pixi.js')> | undefined;

function loadScript(url: string) {
  let pending = scripts.get(url);
  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => fail('Live2D 运行库加载超时'), 15_000);
      const fail = (message: string) => {
        clearTimeout(timeout);
        scripts.delete(url);
        script.remove();
        reject(Error(message));
      };
      script.src = url;
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => fail('Live2D 运行库未能加载');
      document.head.appendChild(script);
    });
    scripts.set(url, pending);
  }
  return pending;
}

export async function loadLive2D(coreUrl: string) {
  await Promise.all([loadScript(coreUrl), loadScript('/vendor/live2d.min.js')]);
  // All portraits share one boot promise. An overlapping mount cannot replace
  // window.PIXI while the UMD adapter is attaching itself to that object.
  pixiRuntime ||= (async () => {
    const PIXI = await import('pixi.js');
    (window as any).PIXI ||= { ...PIXI };
    await loadScript('/vendor/pixi-live2d-display-all-0.4.0.min.js');
    if (!(window as any).PIXI?.live2d?.Live2DModel) {
      scripts.delete('/vendor/pixi-live2d-display-all-0.4.0.min.js');
      throw Error('Live2D 运行库初始化失败');
    }
    return PIXI;
  })().catch((error) => {
    pixiRuntime = undefined;
    throw error;
  });
  return pixiRuntime;
}

export function waitForAvatarSize(container: HTMLElement, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      observer.disconnect();
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) finish();
    };
    const abort = () => finish(signal.reason);
    const observer = new ResizeObserver(check);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    observer.observe(container);
    check();
  });
}
import {
  assetRequestUrl,
  browserNetwork,
  readJson,
  usesNetworkRelay,
} from '@livra/runtime/network';

export async function liveModelSource(modelUrl: string, signal: AbortSignal) {
  const url = new URL(modelUrl, location.href);
  if (url.origin === location.origin || !usesNetworkRelay()) return url.href;
  const manifest = await readJson(await browserNetwork(url.href, { signal }));
  const file = (value: string) => {
    if (!value || /^(data|blob):/.test(value)) return value;
    return new URL(assetRequestUrl(new URL(value, url).href), location.href).href;
  };
  const rewrite = (value: any, key = ''): any => {
    if (typeof value === 'string')
      return /^(file|sound|moc|model|physics|pose|userdata|displayinfo|textures)$/i.test(key)
        ? file(value)
        : value;
    if (Array.isArray(value)) return value.map((entry) => rewrite(entry, key));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([name, entry]) => [name, rewrite(entry, name)]),
      );
    return value;
  };
  return { ...rewrite(manifest), url: url.href };
}
