// Admin panel: game languages (add, translate, publish) and the panel's own settings.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { builtInLanguages, type BuiltInLanguage } from '../i18n/languages';
import { describeError, refreshProfile, rpc } from '../services/online';
import { revealDetail } from './adminWidgets';
import { ADMIN_LANGS, num, setAdminLang, tr, useAdminLang } from './adminText';

interface LanguageMeta {
  code: string;
  label: string;
  dir: 'ltr' | 'rtl';
  locale: string;
  enabled: boolean;
  version: number;
  strings: number;
}

interface LanguagesState {
  revision: number;
  languages: LanguageMeta[];
  translations: Record<string, Record<string, unknown>>;
}

interface Draft {
  isNew: boolean;
  code: string;
  label: string;
  dir: 'ltr' | 'rtl';
  locale: string;
  enabled: boolean;
  base: BuiltInLanguage;
  strings: Record<string, string>;
}

const BUILT_IN = Object.keys(builtInLanguages) as BuiltInLanguage[];
const CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const PAGE_SIZE = 40;
const NEW = '__new';

/** "a.b.c" → text for every string leaf. */
function flatten(tree: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof tree === 'string') out[prefix] = tree;
  else if (typeof tree === 'object' && tree !== null && !Array.isArray(tree)) {
    for (const [k, v] of Object.entries(tree)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

function unflatten(flat: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, text] of Object.entries(flat)) {
    if (!text.trim()) continue;
    const parts = key.split('.');
    let node = root;
    parts.slice(0, -1).forEach((p) => {
      const next = node[p];
      node[p] = typeof next === 'object' && next !== null ? next : {};
      node = node[p] as Record<string, unknown>;
    });
    node[parts[parts.length - 1]!] = text;
  }
  return root;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!);

function validLocale(locale: string): boolean {
  try {
    return Intl.getCanonicalLocales(locale).length === 1;
  } catch {
    return false;
  }
}

function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const englishKeys = Object.keys(flatten(builtInLanguages.en.translation));

export function AdminLanguages({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  useAdminLang();
  const [data, setData] = useState<LanguagesState | null>(null);
  const [selected, setSelected] = useState<string>('en');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    async (err: unknown) => {
      if (err instanceof Response && err.status === 401) onSignOut();
      setMessage({ ok: false, text: await describeError(err) });
    },
    [onSignOut],
  );

  useEffect(() => {
    rpc<LanguagesState>('admin_languages_get', { token }).then(setData, fail);
  }, [token, fail]);

  const open = (code: string) => {
    setSelected(code);
    setMessage(null);
    const meta = data?.languages.find((l) => l.code === code);
    if (meta) {
      setDraft({
        isNew: false,
        code: meta.code,
        label: meta.label,
        dir: meta.dir,
        locale: meta.locale,
        enabled: meta.enabled,
        base: 'en',
        strings: flatten(data?.translations[code] ?? {}),
      });
    } else setDraft(null);
  };

  const startNew = (from?: BuiltInLanguage) => {
    setSelected(NEW);
    setMessage(null);
    const base = from ? builtInLanguages[from] : null;
    setDraft({
      isNew: true,
      code: '',
      label: '',
      dir: base?.dir ?? 'ltr',
      locale: '',
      enabled: false,
      base: from ?? 'en',
      strings: from ? flatten(builtInLanguages[from].translation) : {},
    });
  };

  const save = async () => {
    if (!draft || !data) return;
    const code = draft.code.trim().toLowerCase();
    if (!CODE.test(code) || BUILT_IN.includes(code as BuiltInLanguage)) {
      setMessage({ ok: false, text: tr('lang.invalidCode') });
      return;
    }
    if (draft.isNew && data.languages.some((l) => l.code === code)) {
      setMessage({ ok: false, text: tr('lang.codeTaken') });
      return;
    }
    if (!validLocale(draft.locale)) {
      setMessage({ ok: false, text: tr('lang.invalidLocale') });
      return;
    }
    setBusy(true);
    try {
      const res = await rpc<LanguagesState>('admin_language_set', {
        token,
        language: {
          code,
          label: draft.label,
          dir: draft.dir,
          locale: draft.locale,
          enabled: draft.enabled,
          translation: unflatten(draft.strings),
        },
      });
      setData(res);
      setSelected(code);
      setDraft({ ...draft, isNew: false, code });
      setMessage({ ok: true, text: tr('lang.saved') });
      void refreshProfile().catch(() => undefined);
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft || draft.isNew || !window.confirm(tr('lang.confirmDelete', { x: draft.label }))) return;
    setBusy(true);
    try {
      setData(await rpc<LanguagesState>('admin_language_delete', { token, code: draft.code }));
      setDraft(null);
      setSelected('en');
      void refreshProfile().catch(() => undefined);
    } catch (err) {
      await fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return message ? <p className="admin__error">{message.text}</p> : <p className="admin__note">…</p>;

  const builtIn = BUILT_IN.includes(selected as BuiltInLanguage) ? (selected as BuiltInLanguage) : null;
  return (
    <div className="ad-browser">
      <div className="ad-browser__list" role="listbox" aria-label={tr('page.languages')}>
        {BUILT_IN.map((code) => (
          <div
            key={code}
            role="option"
            aria-selected={selected === code}
            tabIndex={0}
            className={`ad-browser__entry${selected === code ? ' is-active' : ''}`}
            onClick={(e) => {
              open(code);
              revealDetail(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') open(code);
            }}
          >
            <span className="ad-lang__code">{code}</span>
            <span className="ad-item__title">
              <b>{builtInLanguages[code].label}</b>
              <small>{tr('lang.builtIn')}</small>
            </span>
          </div>
        ))}
        {data.languages.map((l) => (
          <div
            key={l.code}
            role="option"
            aria-selected={selected === l.code}
            tabIndex={0}
            className={`ad-browser__entry${selected === l.code ? ' is-active' : ''}`}
            onClick={(e) => {
              open(l.code);
              revealDetail(e.currentTarget);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') open(l.code);
            }}
          >
            <span className="ad-lang__code">{l.code}</span>
            <span className="ad-item__title">
              <b>{l.label}</b>
              <small>
                {tr('lang.progress', {
                  done: num(Math.min(l.strings, englishKeys.length)),
                  total: num(englishKeys.length),
                })}
                {!l.enabled && ` · ${tr('lang.hidden')}`}
              </small>
            </span>
          </div>
        ))}
        <button
          type="button"
          className="admin__btn ad-lang__new"
          onClick={(e) => {
            startNew();
            revealDetail(e.currentTarget);
          }}
        >
          {tr('lang.new')}
        </button>
      </div>

      <div className="ad-browser__detail">
        {message && <p className={message.ok ? 'admin__ok' : 'admin__error'}>{message.text}</p>}
        {builtIn && !draft ? (
          <div className="ad-detail">
            <div className="ad-detail__head">
              <span className="ad-lang__code ad-lang__code--big">{builtIn}</span>
              <span className="ad-item__title">
                <b>{builtInLanguages[builtIn].label}</b>
                <small>
                  {builtInLanguages[builtIn].locale} ·{' '}
                  {tr(builtInLanguages[builtIn].dir === 'rtl' ? 'lang.rtl' : 'lang.ltr')}
                </small>
              </span>
            </div>
            <p className="admin__note">{tr('lang.builtInNote')}</p>
            <div className="ad-lang__actions">
              <button type="button" className="admin__btn admin__btn--primary" onClick={() => startNew(builtIn)}>
                {tr('lang.startFrom', { x: builtInLanguages[builtIn].label })}
              </button>
              <button
                type="button"
                className="admin__btn"
                onClick={() => download(`${builtIn}.json`, builtInLanguages[builtIn].translation)}
              >
                {tr('action.export')}
              </button>
            </div>
          </div>
        ) : draft ? (
          <LanguageEditor
            draft={draft}
            busy={busy}
            onChange={setDraft}
            onSave={() => void save()}
            onDelete={() => void remove()}
          />
        ) : null}
      </div>
    </div>
  );
}

function LanguageEditor({
  draft,
  busy,
  onChange,
  onSave,
  onDelete,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const reference = useMemo(() => flatten(builtInLanguages[draft.base].translation), [draft.base]);
  const english = useMemo(() => flatten(builtInLanguages.en.translation), []);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  const done = englishKeys.filter((k) => draft.strings[k]?.trim()).length;
  const q = filter.trim().toLowerCase();
  const rows = englishKeys.filter(
    (k) =>
      (!missingOnly || !draft.strings[k]?.trim()) &&
      (!q ||
        k.toLowerCase().includes(q) ||
        (reference[k] ?? '').toLowerCase().includes(q) ||
        (draft.strings[k] ?? '').toLowerCase().includes(q)),
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);

  return (
    <div className="ad-detail ad-lang">
      <div className="ad-lang__meta">
        <label>
          <span>{tr('lang.code')}</span>
          <input
            value={draft.code}
            disabled={!draft.isNew}
            dir="ltr"
            placeholder="de"
            onChange={(e) => set({ code: e.target.value.toLowerCase() })}
          />
          <small>{tr('lang.codeHint')}</small>
        </label>
        <label>
          <span>{tr('lang.name')}</span>
          <input
            value={draft.label}
            dir={draft.dir}
            placeholder="Deutsch"
            onChange={(e) => set({ label: e.target.value })}
          />
          <small>{tr('lang.nameHint')}</small>
        </label>
        <label>
          <span>{tr('lang.locale')}</span>
          <input value={draft.locale} dir="ltr" placeholder="de-DE" onChange={(e) => set({ locale: e.target.value })} />
          <small>{tr('lang.localeHint')}</small>
        </label>
        <label>
          <span>{tr('lang.dir')}</span>
          <select value={draft.dir} onChange={(e) => set({ dir: e.target.value as 'ltr' | 'rtl' })}>
            <option value="ltr">{tr('lang.ltr')}</option>
            <option value="rtl">{tr('lang.rtl')}</option>
          </select>
        </label>
        <label>
          <span>{tr('lang.base')}</span>
          <select value={draft.base} onChange={(e) => set({ base: e.target.value as BuiltInLanguage })}>
            {BUILT_IN.map((c) => (
              <option key={c} value={c}>
                {builtInLanguages[c].label}
              </option>
            ))}
          </select>
        </label>
        <label className="ad-lang__toggle">
          <span>{tr('lang.enabled')}</span>
          <span className="ad-switch">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span />
          </span>
          <small>{tr('lang.enabledHint')}</small>
        </label>
      </div>

      <div className="ad-lang__progress">
        <span>{tr('lang.progress', { done: num(done), total: num(englishKeys.length) })}</span>
        <progress value={done} max={englishKeys.length} />
        <small>{tr('lang.untranslatedFallback')}</small>
      </div>

      <div className="ad-lang__actions">
        <button type="button" className="admin__btn admin__btn--primary" disabled={busy} onClick={onSave}>
          {tr('action.saveLanguage')}
        </button>
        <button type="button" className="admin__btn" onClick={() => file.current?.click()}>
          {tr('action.import')}
        </button>
        <button
          type="button"
          className="admin__btn"
          onClick={() => download(`${draft.code || 'language'}.json`, unflatten(draft.strings))}
        >
          {tr('action.export')}
        </button>
        {!draft.isNew && (
          <button type="button" className="admin__btn admin__btn--danger" disabled={busy} onClick={onDelete}>
            {tr('action.delete')}
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            f.text().then(
              (text) => {
                try {
                  const strings = flatten(JSON.parse(text) as unknown);
                  if (Object.keys(strings).length === 0) throw new Error('empty');
                  setImportError(null);
                  set({ strings: { ...draft.strings, ...strings } });
                } catch {
                  setImportError(tr('lang.importFailed'));
                }
              },
              () => setImportError(tr('lang.importFailed')),
            );
          }}
        />
      </div>
      {importError && <p className="admin__error">{importError}</p>}

      <div className="ad-lang__tools">
        <input
          className="dash__search"
          type="search"
          placeholder={tr('lang.filter')}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        />
        <label className="ad-lang__check">
          <input
            type="checkbox"
            checked={missingOnly}
            onChange={(e) => {
              setMissingOnly(e.target.checked);
              setPage(0);
            }}
          />
          {tr('lang.missingOnly')}
        </label>
      </div>

      <div className="ad-lang__rows">
        {rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((k) => {
          const needed = placeholders(english[k] ?? '');
          const text = draft.strings[k] ?? '';
          const lost = text.trim() ? needed.filter((p) => !placeholders(text).includes(p)) : [];
          return (
            <div key={k} className={`ad-lang__row${text.trim() ? '' : ' is-missing'}`}>
              <code dir="ltr">{k}</code>
              <span className="ad-lang__ref" dir={builtInLanguages[draft.base].dir}>
                {reference[k]}
              </span>
              <textarea
                dir={draft.dir}
                rows={Math.min(4, Math.max(1, Math.ceil((reference[k]?.length ?? 0) / 48)))}
                value={text}
                onChange={(e) => set({ strings: { ...draft.strings, [k]: e.target.value } })}
              />
              {lost.length > 0 && (
                <small className="admin__error-text">
                  {tr('lang.placeholders', { x: lost.map((p) => `{{${p}}}`).join(' ') })}
                </small>
              )}
            </div>
          );
        })}
      </div>
      {pages > 1 && (
        <div className="ad-lang__pager">
          <button
            type="button"
            className="admin__btn admin__btn--small"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            ‹
          </button>
          <span>{tr('lang.page', { n: num(current + 1), m: num(pages) })}</span>
          <button
            type="button"
            className="admin__btn admin__btn--small"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminSettings() {
  const lang = useAdminLang();
  return (
    <div className="dash__cards">
      <section className="ad-card">
        <h2>{tr('settings.language')}</h2>
        <p className="admin__note">{tr('settings.languageHint')}</p>
        <div className="ad-settings__langs" role="radiogroup">
          {ADMIN_LANGS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={lang === l.id}
              className={`ad-themes__opt${lang === l.id ? ' is-active' : ''}`}
              dir={l.dir}
              onClick={() => setAdminLang(l.id)}
            >
              <b>{l.label}</b>
              <span>{l.id}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
