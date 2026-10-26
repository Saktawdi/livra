// Search key management and test flow ported from lumen-utools/src/Settings.tsx.
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Globe2, Loader2, ShieldCheck } from 'lucide-react';
import type { Settings } from '@livra/shared';
import { api, post } from './api';
import { KeysEditor } from './ProviderControls';
import { Field, Section } from './ui';
import type { Notify } from './App';
import './providers.css';
import './search-settings.css';

export function SearchSettings({
  settings,
  patch,
  notify,
}: {
  settings: Settings;
  patch: (patch: Partial<Settings>) => void;
  notify: Notify;
}) {
  const [query, setQuery] = useState('uTools 插件开发文档');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirtyKeys = useRef(false);
  const keys = settings.searchKeys ?? (settings.searchKey ? [settings.searchKey] : []);
  useEffect(() => {
    if (
      settings.searchKeys !== undefined ||
      settings.searchKey !== undefined ||
      !settings.hasSearchKey
    )
      return;
    let live = true;
    api<{ keys: string[] }>('/search/keys')
      .then(({ keys }) => {
        if (live && !dirtyKeys.current) patch({ searchKeys: keys, searchKey: keys[0] || '' });
      })
      .catch((error) => {
        if (live) setError((error as Error).message);
      });
    return () => {
      live = false;
    };
  }, [settings.searchKeys !== undefined, settings.searchKey !== undefined, settings.hasSearchKey]);
  async function test() {
    if (busy || !query.trim()) return;
    setBusy(true);
    setResult('');
    setError('');
    try {
      const data = await post('/search/test', {
        query,
        config: {
          searchEngine: settings.searchEngine,
          searchUrl: settings.searchUrl,
          searchKeys: settings.searchKeys,
          searchKey: settings.searchKey,
        },
      });
      setResult(JSON.stringify(data, null, 2));
      notify('搜索连接成功');
    } catch (error) {
      setError((error as Error).message);
      notify((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="providers-settings search-settings">
      <Section title="网页搜索" description="配置服务后，在人偶卡中启用网页搜索。">
        <Field label="搜索服务">
          <select
            value={settings.searchEngine}
            onChange={(event) => {
              const engine = event.target.value as Settings['searchEngine'];
              patch({
                searchEngine: engine,
                searchUrl:
                  engine === 'anysearch'
                    ? 'https://api.anysearch.com/v1/search'
                    : engine === 'tavily'
                      ? 'https://api.tavily.com/search'
                      : '',
              });
              setResult('');
              setError('');
            }}
          >
            <option value="anysearch">AnySearch · 支持匿名搜索</option>
            <option value="tavily">Tavily</option>
            <option value="searxng">SearXNG</option>
          </select>
        </Field>
        <Field
          label="服务地址"
          hint={
            settings.searchEngine === 'searxng'
              ? '例如 https://search.example.com，服务需开启 JSON 输出。'
              : settings.searchEngine === 'anysearch'
                ? '默认使用官方 /v1/search，密钥可选。'
                : '填写完整搜索地址。'
          }
        >
          <input
            type="url"
            value={settings.searchUrl}
            onChange={(event) => patch({ searchUrl: event.target.value })}
            placeholder={
              settings.searchEngine === 'searxng'
                ? 'https://search.example.com'
                : settings.searchEngine === 'tavily'
                  ? 'https://api.tavily.com/search'
                  : 'https://api.anysearch.com/v1/search'
            }
          />
        </Field>
        <KeysEditor
          keys={keys}
          onChange={(searchKeys) => {
            dirtyKeys.current = true;
            patch({ searchKeys, searchKey: searchKeys[0] || '' });
          }}
        />
        <div className="search-info-note">
          <ShieldCheck size={16} />
          <p>
            多个密钥按顺序轮询。遇到鉴权、限流或服务错误时，会尝试下一个密钥。
            {settings.searchEngine === 'anysearch' ? '不填密钥时使用 AnySearch 匿名访问。' : ''}
          </p>
        </div>
        <div className="search-test">
          <h3>测试搜索</h3>
          <div className="search-test-row">
            <input
              aria-label="测试搜索词"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              className="button primary"
              disabled={busy || !query.trim()}
              onClick={() => void test()}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <Globe2 size={15} />}测试
            </button>
          </div>
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          {result && (
            <pre className="search-test-result" aria-label="搜索测试结果">
              {result}
            </pre>
          )}
        </div>
        <a
          className="text-button search-keys-link"
          href="https://anysearch.com/console/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          获取 AnySearch 密钥
          <ExternalLink size={13} />
        </a>
      </Section>
    </div>
  );
}
