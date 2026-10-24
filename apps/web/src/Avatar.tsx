import { memo, useRef, useState } from 'react';
import { Sparkles, UserRound, Upload, RotateCcw } from 'lucide-react';
import { IconButton } from './ui';
import type { Notify } from './App';

export const Avatar = memo(function Avatar({
  role,
  src,
  name,
}: {
  role: 'user' | 'assistant';
  src?: string;
  name?: string;
}) {
  return (
    <span className={'chat-avatar avatar-' + role} aria-hidden="true">
      {role === 'assistant' ? (
        name ? (
          name.slice(0, 1)
        ) : (
          <Sparkles size={17} />
        )
      ) : (
        <UserRound size={17} />
      )}
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
});

export function AvatarPicker({
  label,
  role,
  src,
  onChange,
  notify,
}: {
  label: string;
  role: 'user' | 'assistant';
  src: string;
  onChange: (value: string) => void;
  notify: Notify;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="avatar-picker">
      <Avatar role={role} src={src} />
      <div>
        <strong>{label}</strong>
        <button className="text-link" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={12} />
          {busy ? '处理中…' : '选择图片'}
        </button>
      </div>
      {src && (
        <IconButton label={'恢复' + label + '默认头像'} onClick={() => onChange('')}>
          <RotateCcw size={14} />
        </IconButton>
      )}
      <input
        hidden
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          setBusy(true);
          const url = URL.createObjectURL(file);
          try {
            if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10_000_000)
              throw Error('请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片');
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 192;
            const context = canvas.getContext('2d');
            if (!context) throw Error('图片处理失败');
            const side = Math.min(image.width, image.height);
            context.drawImage(
              image,
              (image.width - side) / 2,
              (image.height - side) / 2,
              side,
              side,
              0,
              0,
              192,
              192,
            );
            onChange(canvas.toDataURL('image/webp', 0.88));
          } catch (error) {
            notify((error as Error).message, 'error');
          } finally {
            URL.revokeObjectURL(url);
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
