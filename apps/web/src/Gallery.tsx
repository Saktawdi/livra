import { useEffect, useState } from 'react';
import {
  Search,
  Star,
  Grid2X2,
  Image,
  Music2,
  Presentation,
  Palette,
  UserRound,
  Download,
  Trash2,
  FileText,
} from 'lucide-react';
import type { Artifact, Settings } from '@livra/shared';
import { PersonaArtifact } from './PersonaArtifact';
import { SkinArtifact, SkinPreview, type AppearancePreview } from './SkinArtifact';
import { api, API, download } from './api';
import { PageIntro, Empty, Badge, IconButton, Button, Modal } from './ui';
import type { Notify } from './App';
const labels: Record<string, string> = {
  image: '图像',
  music: '音乐',
  slides: '演示文稿',
  theme: '主题',
  skin: '皮肤',
  persona: '人偶卡',
  text: '文本',
};
const icons: Record<string, any> = {
  image: Image,
  music: Music2,
  slides: Presentation,
  theme: Palette,
  skin: Palette,
  persona: UserRound,
  text: FileText,
};
export function Gallery({
  settings,
  saveSettings,
  epoch,
  notify,
  onUseTheme,
  onAppearancePreview,
}: {
  settings: Settings;
  saveSettings: (s: Settings) => Promise<Settings>;
  epoch: number;
  notify: Notify;
  onUseTheme: (id: string) => void;
  onAppearancePreview: AppearancePreview;
}) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]),
    [loading, setLoading] = useState(true),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [favorites, setFavorites] = useState(false),
    [detail, setDetail] = useState<Artifact | null>(null);
  const refresh = () =>
    api<Artifact[]>('/artifacts')
      .then(setArtifacts)
      .catch((e) => notify(e.message, 'error'))
      .finally(() => setLoading(false));
  useEffect(() => {
    refresh();
  }, [epoch]);
  async function open(a: Artifact) {
    try {
      setDetail(await api('/artifacts/' + a.id));
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  async function favorite(a: Artifact) {
    try {
      await api('/artifacts/' + a.id, {
        method: 'PATCH',
        body: JSON.stringify({ favorite: !a.favorite }),
      });
      setArtifacts((items) =>
        items.map((x) => (x.id === a.id ? { ...x, favorite: !x.favorite } : x)),
      );
      if (detail?.id === a.id) setDetail({ ...detail, favorite: !a.favorite });
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  async function remove(a: Artifact) {
    if (!confirm('删除这个作品？')) return;
    try {
      await api('/artifacts/' + a.id, { method: 'DELETE' });
      setArtifacts((items) => items.filter((x) => x.id !== a.id));
      if (detail?.id === a.id) setDetail(null);
      notify('作品已删除');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }
  const filtered = artifacts.filter(
    (a) =>
      (filter === 'all' || a.kind === filter) &&
      (!favorites || a.favorite) &&
      (a.title.includes(search) || String(a.data.prompt || '').includes(search)),
  );
  return (
    <div className="content-page gallery-page">
      <PageIntro
        eyebrow="EVERY IDEA LEAVES A LITTLE TRACE"
        title="作品"
        action={
          <Button onClick={() => setFavorites((v) => !v)} className={favorites ? 'selected' : ''}>
            <Star size={15} fill={favorites ? 'currentColor' : 'none'} />
            {favorites ? '正在看收藏' : '我的收藏'}
          </Button>
        }
      />
      <div className="page-filter">
        <div className="filter-tabs">
          {['all', 'image', 'music', 'slides', 'theme', 'skin', 'persona'].map((k) => (
            <button className={filter === k ? 'active' : ''} key={k} onClick={() => setFilter(k)}>
              {k === 'all' ? '全部作品' : labels[k]}
            </button>
          ))}
        </div>
        <div className="inline-search">
          <Search size={15} />
          <input
            placeholder="搜索名称或描述"
            aria-label="搜索作品"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {loading ? (
        <div className="page-loader">正在加载…</div>
      ) : !filtered.length ? (
        <Empty
          symbol={<Grid2X2 size={29} />}
          title={artifacts.length ? '没有找到匹配的作品' : '还没有作品'}
          description={
            artifacts.length
              ? '试试其他关键词或作品类型。'
              : '在工作室或对话中创作，结果会保存在这里。'
          }
        />
      ) : (
        <div className="gallery-grid">
          {filtered.map((a) => {
            const Icon = icons[a.kind] || FileText;
            return (
              <article className={'gallery-card ' + a.kind} key={a.id}>
                <button
                  className="gallery-art"
                  aria-label={'查看 ' + a.title}
                  onClick={() => open(a)}
                >
                  {a.kind === 'skin' ? (
                    <SkinPreview skin={a.data.skin} compact />
                  ) : a.kind === 'image' && a.data.images?.[0] ? (
                    <img loading="lazy" src={API + a.data.images[0]} alt={a.title} />
                  ) : (
                    <div>
                      <Icon size={42} />
                      <span>{a.kind === 'slides' ? a.title : labels[a.kind]}</span>
                      {a.kind === 'theme' && (
                        <div className="theme-colors">
                          <i />
                          <i />
                          <i />
                        </div>
                      )}
                    </div>
                  )}
                  <Badge>{labels[a.kind]}</Badge>
                </button>
                <div className="gallery-card-caption">
                  <button onClick={() => open(a)}>
                    <strong>{a.title}</strong>
                    <small>
                      {new Date(a.created).toLocaleDateString(settings.locale, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </small>
                  </button>
                  <IconButton
                    label={a.favorite ? '取消收藏' : '收藏作品'}
                    className={a.favorite ? 'favorited' : ''}
                    onClick={() => favorite(a)}
                  >
                    <Star size={15} fill={a.favorite ? 'currentColor' : 'none'} />
                  </IconButton>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)} wide>
          <div className="artifact-detail">
            <div className="artifact-meta">
              <Badge>{labels[detail.kind]}</Badge>
              <span>{new Date(detail.created).toLocaleString(settings.locale)}</span>
              {detail.data.model && <span>{detail.data.model}</span>}
            </div>
            {detail.kind === 'image' && (
              <div className="detail-images">
                {detail.data.images.map((image: string, i: number) => (
                  <div key={i}>
                    <img src={image} alt={detail.title} />
                    <a
                      className="button secondary"
                      download={`livra-${detail.id}-${i}.png`}
                      href={image}
                    >
                      <Download size={14} />
                      下载原图
                    </a>
                  </div>
                ))}
              </div>
            )}
            {detail.kind === 'music' && (
              <div className="audio-result">
                <div className="vinyl">
                  <Music2 size={35} />
                </div>
                <audio src={detail.data.audio} controls />
                <a className="button secondary" href={detail.data.audio} download="livra-music.mp3">
                  <Download size={14} />
                  下载音乐
                </a>
              </div>
            )}
            {detail.kind === 'slides' && (
              <iframe
                className="slide-preview"
                sandbox=""
                title="作品预览"
                srcDoc={detail.data.html}
              />
            )}
            {detail.kind === 'theme' && <pre className="artifact-code">{detail.data.css}</pre>}
            {detail.kind === 'skin' && (
              <SkinArtifact
                value={detail.data.skin}
                settings={settings}
                saveSettings={saveSettings}
                onPreview={onAppearancePreview}
                notify={notify}
              />
            )}
            {detail.kind === 'persona' && (
              <PersonaArtifact
                persona={detail.data.persona}
                liveModel={detail.data.liveModel}
                settings={settings}
                saveSettings={saveSettings}
                notify={notify}
              />
            )}
            {detail.data.prompt && <p className="detail-prompt">{detail.data.prompt}</p>}
            {detail.kind === 'text' && (
              <pre className="artifact-code">{String(detail.data.content || '')}</pre>
            )}
          </div>
          <div className="modal-footer">
            <Button variant="danger" onClick={() => remove(detail)}>
              <Trash2 size={14} />
              删除作品
            </Button>
            <div className="button-row">
              {detail.kind === 'theme' && (
                <Button variant="primary" onClick={() => onUseTheme(detail.id)}>
                  <Presentation size={15} />
                  用此主题创作
                </Button>
              )}
              <Button onClick={() => favorite(detail)}>
                <Star size={14} fill={detail.favorite ? 'currentColor' : 'none'} />
                {detail.favorite ? '取消收藏' : '收藏'}
              </Button>
              {['slides', 'theme', 'persona'].includes(detail.kind) && (
                <Button
                  variant="primary"
                  onClick={() =>
                    download(
                      detail.title +
                        (detail.kind === 'slides'
                          ? '.md'
                          : detail.kind === 'theme'
                            ? '.css'
                            : '.persona.json'),
                      detail.kind === 'slides'
                        ? detail.data.markdown
                        : detail.kind === 'theme'
                          ? detail.data.css
                          : JSON.stringify(detail.data.persona, null, 2),
                    )
                  }
                >
                  <Download size={14} />
                  下载源文件
                </Button>
              )}
              {detail.kind === 'slides' && (
                <Button
                  onClick={() => download(detail.title + '.html', detail.data.html, 'text/html')}
                >
                  导出 HTML
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
