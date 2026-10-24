// Compatibility facade for UI commands. No localhost requests are made here.
type Request = {
  workspace: string;
  body: any;
  params: Record<string, string>;
  query: Record<string, string>;
  signal: AbortSignal;
};
class Result {
  status = 200;
  mime = '';
  value: any;
  raw = { on: (_event: string, _callback: () => void) => {} };
  code(status: number) { this.status = status; return this; }
  type(mime: string) { this.mime = mime; return this; }
  send(value: any) { this.value = value; return this; }
}
type Handler = (request: Request, reply: Result) => Promise<any>;
export class LocalRouter {
  private handlers: { method: string; path: string; handler: Handler }[] = [];
  private register(method: string, path: string, options: Handler | object, handler?: Handler) {
    this.handlers.push({ method, path, handler: typeof options === 'function' ? options as Handler : handler! });
  }
  get(path: string, handler: Handler) { this.register('GET', path, handler); }
  post(path: string, options: Handler | object, handler?: Handler) { this.register('POST', path, options, handler); }
  put(path: string, handler: Handler) { this.register('PUT', path, handler); }
  patch(path: string, handler: Handler) { this.register('PATCH', path, handler); }
  delete(path: string, handler: Handler) { this.register('DELETE', path, handler); }
  async execute(path: string, options: RequestInit = {}) {
    const url = new URL('/api' + path, 'https://local.invalid');
    for (const route of this.handlers) {
      if (route.method !== (options.method || 'GET').toUpperCase()) continue;
      const actual = url.pathname.split('/'), expected = route.path.split('/');
      const params: Record<string, string> = {};
      if (actual.length !== expected.length || !expected.every((part, index) => {
        if (part.startsWith(':')) { params[part.slice(1)] = decodeURIComponent(actual[index]); return true; }
        return part === actual[index];
      })) continue;
      const signal = options.signal || AbortSignal.timeout(180_000);
      signal.throwIfAborted();
      const reply = new Result();
      const result = await route.handler({
        workspace: 'browser', params, query: Object.fromEntries(url.searchParams),
        body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined,
        signal,
      }, reply);
      signal.throwIfAborted();
      if (result instanceof Result) {
        if (result.status >= 400) throw Object.assign(Error(result.value.error), { statusCode: result.status });
        return result.mime.startsWith('audio/') ? new Blob([new Uint8Array(result.value)], {type: result.mime}) : result.value;
      }
      return result;
    }
    throw Object.assign(Error('本地操作不存在：' + path), { statusCode: 404 });
  }
}
