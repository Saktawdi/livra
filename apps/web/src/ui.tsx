import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  isValidElement,
  type ReactNode,
  type ReactElement,
  type ButtonHTMLAttributes,
} from 'react';
import { X, LoaderCircle, Copy, Check, CircleAlert } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Select } from './Select';
export { Select };

export function Button({
  children,
  className = '',
  variant = 'secondary',
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${className}`}
    >
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      className={`icon-button ${props.className || ''}`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const el = ref.current!,
      previous = document.activeElement as HTMLElement;
    el.showModal();
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      el.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      className={`modal ${wide ? 'wide' : ''} ${className}`}
      aria-labelledby={titleId}
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="关闭" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const control =
    isValidElement(children) &&
    (children.type === Select ||
      (typeof children.type === 'string' &&
        ['input', 'textarea', 'select'].includes(children.type)));
  return (
    <div className="field">
      {control ? (
        <>
          <label htmlFor={id}>{label}</label>
          {cloneElement(children as ReactElement<any>, {
            id,
            'aria-describedby': hint ? id + '-hint' : undefined,
            ...(children.type === Select ? { 'aria-label': label } : {}),
          })}
        </>
      ) : (
        <>
          <span>{label}</span>
          {children}
        </>
      )}
      {hint && <small id={id + '-hint'}>{hint}</small>}
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch" />
    </label>
  );
}
export function Markdown({ text }: { text: string }) {
  const html = DOMPurify.sanitize(
    marked.parse(text, { async: false, gfm: true, breaks: true }) as string,
    {
      ADD_ATTR: ['target'],
      FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'audio', 'video'],
    },
  );
  return (
    <div
      className="markdown"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
export function Empty({
  symbol,
  title,
  description,
  children,
}: {
  symbol: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-symbol">{symbol}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function PageIntro({
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {description && <p className="muted">{description}</p>}
      {children}
    </section>
  );
}
export function Badge({ children, color = '' }: { children: ReactNode; color?: string }) {
  return <span className={'badge ' + color}>{children}</span>;
}
export function CopyButton({
  text,
  onError,
}: {
  text: string;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setStatus('idle');
    return () => clearTimeout(timer.current);
  }, [text]);
  return (
    <IconButton
      label={
        status === 'copied' ? '已复制消息' : status === 'error' ? '复制失败，点击重试' : '复制消息'
      }
      onClick={async () => {
        clearTimeout(timer.current);
        try {
          await navigator.clipboard.writeText(text);
          setStatus('copied');
        } catch {
          setStatus('error');
          onError('无法访问剪贴板，请选择文本复制');
        }
        timer.current = setTimeout(() => setStatus('idle'), 1600);
      }}
    >
      {status === 'copied' ? (
        <Check size={13} />
      ) : status === 'error' ? (
        <CircleAlert size={13} />
      ) : (
        <Copy size={13} />
      )}
    </IconButton>
  );
}
