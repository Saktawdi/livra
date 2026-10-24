import { useEffect, useState } from 'react';
import { Download, Music2, Presentation } from 'lucide-react';
import type { Artifact, Settings } from '@livra/shared';
import { PersonaArtifact } from './PersonaArtifact';
import { SkinArtifact, type AppearancePreview } from './SkinArtifact';
import { api, download } from './api';
import { Modal, Button, Badge } from './ui';
import type { Notify } from './App';

export function ArtifactPreview({
  id,
  onClose,
  settings,
  saveSettings,
  notify,
  onUseTheme,
  onAppearancePreview,
}: {
  id: string;
  onClose: () => void;
  settings: Settings;
  saveSettings: (s: Settings) => Promise<Settings>;
  notify: Notify;
  onUseTheme: (id: string) => void;
  onAppearancePreview: AppearancePreview;
}) {
  const [item, setItem] = useState<Artifact | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<Artifact>('/artifacts/' + id, { signal: controller.signal })
      .then(setItem)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id]);
  const labels = {
    image: '图像',
    music: '音乐',
    slides: '演示文稿',
    theme: 'Marp 主题',
    skin: '皮肤',
    persona: '人偶卡',
    text: '文本',
  };
  function source() {
    if (!item) return;
    const type = item.kind;
    download(
      item.title +
        (type === 'slides'
          ? '.md'
          : type === 'theme'
            ? '.css'
            : type === 'persona'
              ? '.persona.json'
              : '.txt'),
      type === 'slides'
        ? item.data.markdown
        : type === 'theme'
          ? item.data.css
          : type === 'persona'
            ? JSON.stringify(item.data.persona, null, 2)
            : String(item.data.content || ''),
    );
  }
  return (
    <Modal title={item?.title || '打开作品'} onClose={onClose} wide>
      <div className="artifact-detail">
        {error ? (
          <p role="alert" className="error-box">
            {error}
          </p>
        ) : !item ? (
          <div className="page-loader" role="status">
            正在打开作品…
          </div>
        ) : (
          <>
            <div className="artifact-meta">
              <Badge>{labels[item.kind]}</Badge>
              {item.data.model && <span>{item.data.model}</span>}
            </div>
            {item.kind === 'slides' && (
              <iframe
                className="slide-preview"
                sandbox=""
                title="作品预览"
                srcDoc={item.data.html}
              />
            )}
            {item.kind === 'image' && (
              <div className="detail-images">
                {item.data.images?.map((src: string, i: number) => (
                  <figure key={i}>
                    <img src={src} alt={item.title} />
                    <a className="button secondary" href={src} download={`livra-${i}.png`}>
                      <Download size={16} />
                      下载图像
                    </a>
                  </figure>
                ))}
              </div>
            )}
            {item.kind === 'music' && (
              <div className="audio-result">
                <Music2 size={44} />
                <audio src={item.data.audio} controls />
                <a className="button secondary" href={item.data.audio} download="livra-music.mp3">
                  <Download size={16} />
                  下载音频
                </a>
              </div>
            )}
            {['theme', 'text'].includes(item.kind) && (
              <pre className="artifact-code">{item.data.css || item.data.content}</pre>
            )}
            {item.kind === 'persona' && (
              <PersonaArtifact
                persona={item.data.persona}
                liveModel={item.data.liveModel}
                settings={settings}
                saveSettings={saveSettings}
                notify={notify}
              />
            )}
            {item.kind === 'skin' && (
              <SkinArtifact
                value={item.data.skin}
                settings={settings}
                saveSettings={saveSettings}
                onPreview={onAppearancePreview}
                notify={notify}
              />
            )}
            {item.data.prompt && (
              <details className="source-details">
                <summary>生成描述</summary>
                <p>{item.data.prompt}</p>
              </details>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <span />
        <div className="button-row">
          <Button onClick={onClose}>关闭</Button>
          {item && ['slides', 'theme', 'persona', 'text'].includes(item.kind) && (
            <Button onClick={source}>
              <Download size={16} />
              下载源文件
            </Button>
          )}
          {item?.kind === 'slides' && (
            <Button
              variant="primary"
              onClick={() => download(item.title + '.html', item.data.html, 'text/html')}
            >
              导出 HTML
            </Button>
          )}
          {item?.kind === 'theme' && (
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                onUseTheme(item.id);
              }}
            >
              <Presentation size={15} />
              用此主题创作
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
