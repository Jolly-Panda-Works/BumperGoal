import { TeamCarPreview } from './TeamCarPreview';
import { showMessage, type MessageTone } from './messages';
import { createPortal, flushSync } from 'react-dom';
import {
  Children,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { arenasConfig, cosmetics } from '@flickkick/config';
import { avatarUrl, ballUrl, uiUrl } from '../game/art';
import { formatNumber } from '../i18n';
import { connect, useOnline } from '../services/online';
import { useSettings } from '../services/settings';
import { IconClose, IconCoin, IconGem, IconInfo, IconOffline } from './icons';
import { RetryImage } from './RetryImage';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  block,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} btn--${size} ${block ? 'btn--block' : ''} ${className}`}
      {...rest}
    >
      {icon && <span className="btn__icon">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Card({ children, className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner__ball" aria-hidden="true" />
      {label && <span className="spinner__label">{label}</span>}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 100;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <div className="progress__fill" style={{ inlineSize: `${pct}%` }} />
    </div>
  );
}

/** Exported art with a placeholder for a missing or failed file (decorative: empty alt). */
export function ArtImage({
  src,
  fallback = null,
  className,
  size,
}: {
  src: string | undefined;
  fallback?: ReactNode;
  className?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const onFailed = useCallback(() => setFailed(true), []);
  if (!src || failed) return <>{fallback}</>;
  return (
    <RetryImage
      className={className}
      src={src}
      width={size}
      height={size}
      alt=""
      decoding="async"
      draggable={false}
      onFailed={onFailed}
    />
  );
}

/** The Bumper Goal wordmark (art), with the text logo as fallback. */
export function Logo({ big = false }: { big?: boolean }) {
  return (
    <span className={`logo ${big ? 'logo--big' : ''}`} aria-label="Bumper Goal">
      <span className="logo__flick">Bumper</span> <span className="logo__kick">Goal</span>
    </span>
  );
}
const GROUP_ORDER = ['original', 'nation', 'club'];

/**
 * Shop/locker sections. Teams split by their catalog group (Bumper Goal, national,
 * club); other kinds are one untitled section.
 */
export function catalogSections<T extends { id: string; group?: string }>(
  items: T[],
): { group: string | null; items: T[] }[] {
  if (!items.some((i) => i.group)) return [{ group: null, items }];
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((i) => (i.group ?? 'original') === group) })).filter(
    (s) => s.items.length > 0,
  );
}

/** Renders catalog sections with a sub-heading per group. */
export function CatalogSections<T extends { id: string; group?: string }>({
  items,
  render,
}: {
  items: T[];
  render: (item: T) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      {catalogSections(items).map((section) => (
        <section key={section.group ?? 'all'} className="catalog-section">
          {section.group && (
            <h3 className="catalog-section__title">
              {t(`shop.groups.${section.group}`)} <span className="muted">({formatNumber(section.items.length)})</span>
            </h3>
          )}
          <div className="item-grid">{section.items.map(render)}</div>
        </section>
      ))}
    </>
  );
}

export const RANKS = ['bronze', 'silver', 'gold', 'platinum', 'legend'] as const;
export type Rank = (typeof RANKS)[number];

/** Rank tier = how many arenas a level has unlocked (Park → Bronze … Legends → Legend). */
export function rankForLevel(level: number): Rank {
  const unlocked = arenasConfig.arenas.filter((a) => level >= a.minLevel).length;
  return RANKS[Math.min(RANKS.length - 1, Math.max(0, unlocked - 1))]!;
}

export function RankBadge({ rank, size = 40, label = true }: { rank: Rank; size?: number; label?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="rank-badge" title={t(`ranks.${rank}`)}>
      <ArtImage src={uiUrl(`rank_${rank}`)} size={size} />
      {label && <span>{t(`ranks.${rank}`)}</span>}
    </span>
  );
}

export function CurrencyIcon({ currency, size = 20 }: { currency: 'coins' | 'gems'; size?: number }) {
  return currency === 'coins' ? (
    <ArtImage className="currency-icon" src={uiUrl('coin')} size={size} fallback={<IconCoin size={size} />} />
  ) : (
    <ArtImage className="currency-icon" src={uiUrl('gem')} size={size} fallback={<IconGem size={size} />} />
  );
}

export function CurrencyPill({ currency, amount }: { currency: 'coins' | 'gems'; amount: number | null }) {
  const { t } = useTranslation();
  return (
    <span className="currency-pill" title={t(`common.${currency}`)}>
      <CurrencyIcon currency={currency} />
      <span className="currency-pill__amount">{amount === null ? '—' : formatNumber(amount)}</span>
    </span>
  );
}

export function PriceTag({ price }: { price: Partial<Record<'coins' | 'gems', number>> | null }) {
  const { t } = useTranslation();
  if (!price) return <span className="price price--free">{t('common.free')}</span>;
  const [currency, amount] = Object.entries(price)[0] as ['coins' | 'gems', number];
  return (
    <span className="price">
      <CurrencyIcon currency={currency} size={16} />
      {formatNumber(amount)}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'bot' | 'success' | 'danger';
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

const AVATAR_COLORS: Record<string, [string, string]> = {
  avatar_fox: ['#FF9F1C', '#FFF3E0'],
  avatar_owl: ['#7B6CF6', '#EDEBFF'],
  avatar_bear: ['#A86B3C', '#F6E7DA'],
  avatar_tiger: ['#FF7A00', '#1B1B1B'],
  bot: ['#5B6B9A', '#C6FF3D'],
};

export function Avatar({ id, size = 48, frame }: { id: string; size?: number; frame?: 'level' | 'bot' }) {
  return (
    <span className={`avatar ${frame ? `avatar--${frame}` : ''}`} style={{ inlineSize: size, blockSize: size }}>
      <ArtImage src={avatarUrl(id)} size={size} fallback={<PlaceholderAvatar id={id} size={size} />} />
    </span>
  );
}

/** Fallback when the avatar art is missing: original geometric faces. */
function PlaceholderAvatar({ id, size }: { id: string; size: number }) {
  const [main, accent] = AVATAR_COLORS[id] ?? AVATAR_COLORS.avatar_fox!;
  const isBot = id === 'bot';
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="#18234A" />
      {isBot ? (
        <>
          <rect x="11" y="14" width="26" height="22" rx="6" fill={main} />
          <circle cx="19" cy="25" r="3" fill={accent} />
          <circle cx="29" cy="25" r="3" fill={accent} />
          <path d="M24 8v6" stroke={main} strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <>
          {id === 'avatar_fox' && <path d="M10 12l8 8h12l8-8-2 18-12 10-12-10z" fill={main} />}
          {id === 'avatar_owl' && <ellipse cx="24" cy="27" rx="14" ry="15" fill={main} />}
          {id === 'avatar_bear' && (
            <>
              <circle cx="13" cy="14" r="5" fill={main} />
              <circle cx="35" cy="14" r="5" fill={main} />
              <circle cx="24" cy="27" r="14" fill={main} />
            </>
          )}
          {id === 'avatar_tiger' && (
            <>
              <circle cx="24" cy="26" r="15" fill={main} />
              <path d="M12 20h6M30 20h6M14 30h5M29 30h5" stroke={accent} strokeWidth="2.5" />
            </>
          )}
          <circle cx="19" cy="25" r="3.4" fill={accent} />
          <circle cx="29" cy="25" r="3.4" fill={accent} />
          <circle cx="19" cy="25" r="1.5" fill="#111" />
          <circle cx="29" cy="25" r="1.5" fill="#111" />
          <path d="M22 31h4l-2 2z" fill="#111" />
        </>
      )}
    </svg>
  );
}

export function TeamSwatch({ teamId, size = 32 }: { teamId: string; size?: number }) {
  return <TeamCarPreview teamId={teamId} size={size} />;
}

export function BallPreview({ ballId, size = 48 }: { ballId: string; size?: number }) {
  const ball = cosmetics.balls.find((b) => b.id === ballId) ?? cosmetics.balls[0]!;
  return (
    <ArtImage
      className="ball-art"
      src={ballUrl(ball.id)}
      size={size}
      fallback={
        <span className="ball-preview" style={{ background: ball.primary, borderColor: ball.secondary }}>
          <span style={{ background: ball.secondary }} />
        </span>
      }
    />
  );
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  actions,
  dismissible = true,
  messageTone,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
  dismissible?: boolean;
  messageTone?: MessageTone;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const { reducedMotion } = useSettings();
  const [present, setPresent] = useState(open);
  const visible = open || present;
  const content = useRef({ title, children, actions });
  useEffect(() => {
    if (open) content.current = { title, children, actions };
  }, [open, title, children, actions]);
  const shown = open ? { title, children, actions } : content.current;
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = () => {
    if (open) onClose();
  };

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;
    const reduce = reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setPresent(false), reduce ? 0 : 160);
    return () => window.clearTimeout(timer);
  }, [open, present, reducedMotion]);

  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, [href], input, select')?.focus();
    const onKey = (e: KeyboardEvent) => {
      const top =
        document.querySelector('.message-popup:not(.is-closing) .dialog') ??
        Array.from(document.querySelectorAll('.dialog-backdrop:not(.is-closing) .dialog')).at(-1);
      if (top !== ref.current) return;
      if (e.key === 'Escape' && dismissible) closeRef.current();
      if (e.key === 'Tab') {
        const targets = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ) ?? [],
        );
        const first = targets[0],
          last = targets.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [visible, dismissible]);

  if (!visible) return null;
  return createPortal(
    <div
      className={`dialog-backdrop ${open ? 'is-opening' : 'is-closing'} ${messageTone ? `message-popup message-popup--${messageTone}` : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && dismissible && closeRef.current()}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="dialog__header">
          <h2 id={titleId}>{shown.title}</h2>
          {dismissible && (
            <IconButton label={t('common.close')} onClick={() => closeRef.current()}>
              <IconClose />
            </IconButton>
          )}
        </div>
        {shown.children && <div className="dialog__body">{shown.children}</div>}
        {shown.actions && <div className="dialog__actions">{shown.actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <p>{body}</p>
    </Dialog>
  );
}

type StateArt = 'empty-history' | 'empty-wallet' | 'not-found' | 'offline-server' | 'error';

/** State illustration, or the round icon when the art is missing. */
function StateVisual({ art, icon }: { art?: StateArt; icon: ReactNode }) {
  const fallback = <div className="state__icon">{icon}</div>;
  return art ? <ArtImage className="state__art" src={uiUrl(`state_${art}`)} fallback={fallback} /> : fallback;
}

export function EmptyState({
  art,
  icon,
  title,
  body,
  action,
}: {
  art?: StateArt;
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state state--empty">
      <StateVisual art={art} icon={icon ?? <IconInfo size={40} />} />
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  const retry = useRef(onRetry);
  retry.current = onRetry;
  const retryable = !!onRetry;
  useEffect(() => {
    showMessage(
      [title, body].filter(Boolean).join('\n'),
      'error',
      retryable ? { label: t('common.retry'), run: () => retry.current?.() } : undefined,
    );
  }, [title, body, t, retryable]);
  return <div className="state state--error">{onRetry && <Button onClick={onRetry}>{t('common.retry')}</Button>}</div>;
}

/**
 * Truthful state for online features: either the server is not reachable,
 * or it is connected but this feature's server side is not built yet.
 */
export function RequiresServer({ ready = false, compact = false }: { ready?: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  const { status } = useOnline();
  if (ready && status === 'online') return null;
  const connected = status === 'online';
  if (compact)
    return (
      <div className="server-notice" role="status">
        <IconInfo size={20} />
        <span>{t('shop.availability')}</span>
      </div>
    );
  return (
    <div className="state state--server">
      {connected ? (
        <StateVisual icon={<IconInfo size={40} />} />
      ) : (
        <StateVisual art="offline-server" icon={<IconOffline size={40} />} />
      )}
      <h3>{connected ? t('common.comingTitle') : t('common.requiresServerTitle')}</h3>
      <p>{connected ? t('common.coming') : t('common.requiresServer')}</p>
      {(status === 'error' || status === 'offline') && (
        <Button variant="secondary" onClick={() => void connect()}>
          {t('common.connect')}
        </Button>
      )}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field field--row">
      <label htmlFor={id} className="field__label">
        {label}
        {hint && <small>{hint}</small>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={`toggle ${checked ? 'toggle--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.05,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
        <output htmlFor={id}>{format ? format(value) : formatNumber(Math.round(value * 100))}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? 'is-active' : ''}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  animate = true,
}: {
  value: T;
  tabs: { id: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  animate?: boolean;
}) {
  return (
    <div className={`tabs ${tabs.some((tab) => tab.icon) ? 'tabs--icons' : ''}`} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-label={tab.label}
          title={tab.label}
          aria-selected={tab.id === value}
          className={tab.id === value ? 'is-active' : ''}
          onClick={(event) => {
            if (!animate) {
              onChange(tab.id);
              return;
            }
            if (tab.id === value) {
              onChange(tab.id);
              return;
            }
            const reduce =
              document.documentElement.classList.contains('reduced-motion') ||
              window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reduce) {
              onChange(tab.id);
              return;
            }
            if (document.startViewTransition) {
              const transition = document.startViewTransition(() => flushSync(() => onChange(tab.id)));
              // Rapid tab changes/navigation can legitimately skip a snapshot.
              void transition.ready.catch(() => undefined);
            } else {
              const screen = event.currentTarget.closest('.screen');
              onChange(tab.id);
              screen?.animate(
                [
                  { opacity: 0.5, transform: 'translateY(5px)' },
                  { opacity: 1, transform: 'none' },
                ],
                { duration: 180 },
              );
            }
          }}
        >
          {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
          <span className={tab.icon ? 'tab-icon-label' : undefined}>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

export function ScreenHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="screen-header">
      {onBack && (
        <IconButton label={t('common.back')} onClick={onBack} className="flip-rtl">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            aria-hidden="true"
          >
            <path d="M15 5 8 12l7 7" />
          </svg>
        </IconButton>
      )}
      <h1>{title}</h1>
      <div className="screen-header__right">{right}</div>
    </header>
  );
}

/** The first child is the fixed heading; all remaining children share one scroller. */
export function PanelScreen({ children, className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  const [heading, ...content] = Children.toArray(children);
  return (
    <div className={`screen panel-screen ${className}`} {...rest}>
      <div className="panel-screen__heading">{heading}</div>
      <div className="panel-screen__body">{content}</div>
    </div>
  );
}
