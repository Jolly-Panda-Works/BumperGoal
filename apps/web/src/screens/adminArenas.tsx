// Admin panel: arenas (fees, levels, look, new arenas) and the economy page layout.
import { useRef, useState } from 'react';
import { NEW_ARENA_PATH, type ArenaArt, type ArenaDef, type ArtImage, type Price } from '@flickkick/config';
import { assetUrl, goalArt, themeArt, uiUrl } from '../game/art';
import { assetRefUrl, registerAsset, useAssetsVersion } from '../services/assets';
import { describeError, rpc } from '../services/online';
import { Node, NumberInput, ThemePicker, Tip, type EditContext } from './Admin';
import { fieldLabel, num, tr, useAdminLang, type AdminKey } from './adminText';
import { revealDetail } from './adminWidgets';

type Part = keyof ArenaArt;
const PARTS: Part[] = ['cover', 'background', 'turf', 'frame', 'goal'];

/** Longest side and JPEG/WebP quality start for each part; the server caps an upload near 360 KB. */
const LIMITS: Record<Part, number> = { cover: 1280, background: 1920, turf: 1620, frame: 1400, goal: 480 };
const MAX_DATA_URL = 470000;

async function encodeImage(file: File, longest: number): Promise<{ data: string; w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, w, h);
    let data = canvas.toDataURL('image/webp', 0.86 - attempt * 0.06);
    if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/png');
    if (data.length <= MAX_DATA_URL) return { data, w, h };
    scale *= 0.8;
  }
  throw new Error(tr('image.tooBig'));
}

/** Built-in art of a theme for one part (used where nothing is uploaded). */
function themePartUrl(theme: string, part: Part): string | undefined {
  const t = themeArt(theme);
  switch (part) {
    case 'cover':
      return uiUrl(`arena_${theme}`);
    case 'background':
      return t && assetUrl(t.bg.file);
    case 'turf':
      return t && assetUrl(t.turf.file);
    case 'frame':
      return t && assetUrl(t.frame.file);
    case 'goal': {
      const g = goalArt();
      return g ? assetUrl(g.file) : undefined;
    }
  }
}

function partUrl(art: ArenaArt, theme: string, part: Part): string | undefined {
  return assetRefUrl(art[part]?.src) ?? themePartUrl(theme, part);
}

interface Added {
  id: string;
  value: Omit<ArenaDef, 'id'>;
}

export function ArenasPage({ ctx }: { ctx: EditContext }) {
  useAdminLang();
  useAssetsVersion();
  const defaults = (ctx.defaults.arenas as { arenas: ArenaDef[] }).arenas;
  const added: Added[] = Object.entries(ctx.draft).flatMap(([path, value]) => {
    const id = NEW_ARENA_PATH.exec(path)?.[1];
    return id ? [{ id, value: value as Omit<ArenaDef, 'id'> }] : [];
  });
  const [selected, setSelected] = useState<string>(defaults[0]?.id ?? '');
  const [creating, setCreating] = useState(false);
  const all = [...defaults.map((a) => ({ id: a.id, added: false })), ...added.map((a) => ({ id: a.id, added: true }))];
  const current = all.find((a) => a.id === selected) ?? all[0];

  const effective = (id: string): ArenaDef => {
    const base = defaults.find((a) => a.id === id) ?? { ...added.find((a) => a.id === id)!.value, id };
    const val = <K extends keyof ArenaDef>(k: K) =>
      (ctx.draft[`arenas/arenas/@${id}/${k}`] as ArenaDef[K] | undefined) ?? base[k];
    return {
      ...base,
      entryFee: val('entryFee'),
      minLevel: val('minLevel'),
      xpMultiplier: val('xpMultiplier'),
      theme: val('theme'),
      art: (ctx.draft[`arenas/arenas/@${id}/art`] as ArenaArt | undefined) ?? {},
    };
  };
  const name = (a: ArenaDef) => a.names?.en ?? fieldLabel(a.id);

  return (
    <div className="dash__cards">
      <section className="ad-card">
        <h2>{tr('card.general')}</h2>
        <Node
          value={(ctx.defaults.arenas as { houseCut: number }).houseCut}
          path="arenas/houseCut"
          name="houseCut"
          depth={1}
          ctx={ctx}
        />
      </section>
      <section className="ad-card ad-card--wide">
        <h2>{fieldLabel('arenas')}</h2>
        <div className="ad-browser">
          <div className="ad-browser__list" role="listbox" aria-label={fieldLabel('arenas')}>
            {all.map(({ id, added: isAdded }) => {
              const a = effective(id);
              const changed = Object.keys(ctx.draft).filter(
                (p) => p.startsWith(`arenas/arenas/@${id}/`) || p === `arenas/arenas/+${id}`,
              ).length;
              return (
                <div
                  key={id}
                  role="option"
                  aria-selected={current?.id === id}
                  tabIndex={0}
                  className={`ad-browser__entry${current?.id === id ? ' is-active' : ''}`}
                  onClick={(e) => {
                    setSelected(id);
                    setCreating(false);
                    revealDetail(e.currentTarget);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSelected(id);
                  }}
                >
                  <span className="ad-item__thumb ad-item__thumb--wide">
                    {partUrl(a.art ?? {}, a.theme, 'cover') && (
                      <img src={partUrl(a.art ?? {}, a.theme, 'cover')} alt="" />
                    )}
                  </span>
                  <span className="ad-item__title">
                    <b>{name(a)}</b>
                    <small>
                      {id} · {num(a.entryFee)} {tr('price.coins')}
                      {isAdded && ` · ${tr('arena.added')}`}
                    </small>
                  </span>
                  {changed > 0 && <span className="dash__badge">{changed}</span>}
                </div>
              );
            })}
            <button
              type="button"
              className="admin__btn ad-lang__new"
              onClick={(e) => {
                setCreating(true);
                revealDetail(e.currentTarget);
              }}
            >
              {tr('arena.new')}
            </button>
          </div>
          <div className="ad-browser__detail">
            {creating ? (
              <NewArenaForm
                taken={all.map((a) => a.id)}
                template={effective(all[all.length - 1]!.id)}
                onCreate={(id, value) => {
                  ctx.onChange(`arenas/arenas/+${id}`, value, undefined);
                  setSelected(id);
                  setCreating(false);
                }}
              />
            ) : current ? (
              <ArenaDetail arena={effective(current.id)} added={current.added} ctx={ctx} />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function NewArenaForm({
  taken,
  template,
  onCreate,
}: {
  taken: string[];
  template: ArenaDef;
  onCreate: (id: string, value: Omit<ArenaDef, 'id'>) => void;
}) {
  const [id, setId] = useState('');
  const [en, setEn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!/^[a-z][a-z0-9_]{1,23}$/.test(id)) return setError(tr('arena.invalidId'));
    if (taken.includes(id)) return setError(tr('arena.idTaken'));
    if (!en.trim()) return setError(tr('arena.needName'));
    onCreate(id, {
      entryFee: template.entryFee,
      minLevel: template.minLevel,
      xpMultiplier: template.xpMultiplier,
      theme: template.theme,
      names: { en: en.trim() },
    });
  };
  return (
    <div className="ad-detail ad-lang">
      <div className="ad-lang__meta">
        <label>
          <span>{tr('arena.id')}</span>
          <input dir="ltr" value={id} placeholder="desert" onChange={(e) => setId(e.target.value.toLowerCase())} />
          <small>{tr('arena.idHint')}</small>
        </label>
        <label>
          <span>{tr('arena.nameIn', { x: 'English' })}</span>
          <input dir="ltr" value={en} placeholder="Desert" onChange={(e) => setEn(e.target.value)} />
        </label>
      </div>
      {error && <p className="admin__error">{error}</p>}
      <div className="ad-lang__actions">
        <button type="button" className="admin__btn admin__btn--primary" onClick={submit}>
          {tr('arena.create')}
        </button>
      </div>
    </div>
  );
}

function ArenaDetail({ arena, added, ctx }: { arena: ArenaDef; added: boolean; ctx: EditContext }) {
  const newPath = `arenas/arenas/+${arena.id}`;
  const value = ctx.draft[newPath] as Omit<ArenaDef, 'id'> | undefined;
  const setAdded = (patch: Partial<Omit<ArenaDef, 'id'>>) => ctx.onChange(newPath, { ...value, ...patch }, undefined);
  const remove = () => {
    if (!window.confirm(tr('arena.confirmDelete', { x: arena.names?.en ?? arena.id }))) return;
    for (const p of Object.keys(ctx.draft)) {
      if (p === newPath || p.startsWith(`arenas/arenas/@${arena.id}/`)) ctx.onChange(p, undefined, undefined);
    }
  };
  const field = (key: 'entryFee' | 'minLevel' | 'xpMultiplier') =>
    added ? (
      <div className="ad-row" key={key}>
        <span className="ad-row__label">
          {fieldLabel(key)}
          <Tip field={key} />
        </span>
        <span className="ad-row__editor">
          <NumberInput
            value={value?.[key] ?? arena[key]}
            step={key === 'xpMultiplier' ? 0.1 : key === 'entryFee' ? 50 : 1}
            onChange={(v) => setAdded({ [key]: v })}
          />
        </span>
        <span />
      </div>
    ) : (
      <Node
        key={key}
        value={(arena as unknown as Record<string, number>)[key]}
        path={`arenas/arenas/@${arena.id}/${key}`}
        name={key}
        depth={1}
        ctx={ctx}
      />
    );

  return (
    <>
      <div className="ad-detail">
        <div className="ad-detail__head">
          <span className="ad-item__title">
            <b>{arena.names?.en ?? fieldLabel(arena.id)}</b>
            <small dir="ltr">{arena.id}</small>
          </span>
          {added && (
            <button type="button" className="admin__btn admin__btn--small admin__btn--danger" onClick={remove}>
              {tr('arena.delete')}
            </button>
          )}
        </div>
        {added && (
          <div className="ad-lang__meta ad-arena__names">
            {(['en', 'fa', 'ar'] as const).map((lang) => (
              <label key={lang}>
                <span>{tr('arena.nameIn', { x: lang })}</span>
                <input
                  dir={lang === 'en' ? 'ltr' : 'rtl'}
                  value={value?.names?.[lang] ?? ''}
                  onChange={(e) => setAdded({ names: { ...value?.names, [lang]: e.target.value } })}
                />
              </label>
            ))}
          </div>
        )}
        {field('entryFee')}
        {field('minLevel')}
        {field('xpMultiplier')}
        {added ? (
          <div className="ad-row ad-row--block">
            <span className="ad-row__label">
              {fieldLabel('theme')}
              <Tip field="theme" />
            </span>
            <span className="ad-row__editor">
              <ThemePicker value={value?.theme ?? arena.theme} onChange={(t) => setAdded({ theme: t })} />
            </span>
          </div>
        ) : (
          <Node value={arena.theme} path={`arenas/arenas/@${arena.id}/theme`} name="theme" depth={1} ctx={ctx} />
        )}
      </div>
      <ArenaArtEditor arena={arena} ctx={ctx} />
    </>
  );
}

function ArenaArtEditor({ arena, ctx }: { arena: ArenaDef; ctx: EditContext }) {
  const path = `arenas/arenas/@${arena.id}/art`;
  const art = (ctx.draft[path] as ArenaArt | undefined) ?? {};
  const [busy, setBusy] = useState<Part | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<Part>('cover');

  const setArt = (next: ArenaArt) => ctx.onChange(path, Object.keys(next).length ? next : undefined, undefined);
  const setPart = <P extends Part>(part: P, img: ArenaArt[P] | undefined) => {
    const next = { ...art };
    if (img) next[part] = img;
    else delete next[part];
    setArt(next);
  };

  const upload = async (part: Part, file: File) => {
    setBusy(part);
    setError(null);
    try {
      const { data, w, h } = await encodeImage(file, LIMITS[part]);
      const res = await rpc<{ id: string; w: number; h: number }>('admin_asset_put', { token: ctx.token, data });
      const src = `asset:${res.id}`;
      registerAsset(src, data);
      const img: ArtImage = { src, w, h };
      if (part === 'frame') {
        const base = themeArt(arena.theme)?.frame;
        const k = base ? w / base.w : 1;
        const inset = (n: number | undefined, fallback: number) => Math.round((n ?? fallback) * k);
        setPart('frame', {
          ...img,
          insets: {
            left: inset(base?.insets.left, w * 0.08),
            top: inset(base?.insets.top, h * 0.08),
            right: inset(base?.insets.right, w * 0.08),
            bottom: inset(base?.insets.bottom, h * 0.08),
          },
        });
      } else if (part === 'goal') {
        setPart('goal', { ...img, mouthX: goalArt()?.mouthX ?? 0.75 });
      } else setPart(part, img);
    } catch (err) {
      setError(err instanceof Error && !(err instanceof Response) ? err.message : await describeError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ad-detail">
      <div className="ad-detail__head">
        <span className="ad-item__title">
          <b>{tr('arena.look')}</b>
          <small>{tr('arena.lookHint')}</small>
        </span>
      </div>
      <ArenaPreview art={art} theme={arena.theme} />
      {error && <p className="admin__error">{error}</p>}
      <div className="ad-art">
        {PARTS.map((part) => {
          const url = partUrl(art, arena.theme, part);
          const frame = part === 'frame' ? art.frame : undefined;
          const goal = part === 'goal' ? art.goal : undefined;
          return (
            <div key={part} className={`ad-art__slot${art[part] ? ' is-changed' : ''}`}>
              <div className="ad-art__img">{url ? <img src={url} alt="" /> : null}</div>
              <div className="ad-art__body">
                <b>
                  {tr(`art.${part}` as AdminKey)}
                  <span className="ad-art__state">{art[part] ? tr('art.uploaded') : tr('art.themeArt')}</span>
                </b>
                <small>{tr(`art.${part}.hint` as AdminKey)}</small>
                <span className="ad-art__actions">
                  <button
                    type="button"
                    className="admin__btn admin__btn--small"
                    disabled={busy !== null}
                    onClick={() => {
                      target.current = part;
                      input.current?.click();
                    }}
                  >
                    {busy === part ? tr('art.uploading') : tr('action.upload')}
                  </button>
                  {art[part] && (
                    <button
                      type="button"
                      className="admin__btn admin__btn--small"
                      onClick={() => setPart(part, undefined)}
                    >
                      {tr('action.reset')}
                    </button>
                  )}
                </span>
                {frame && (
                  <span className="ad-art__insets">
                    <span>{tr('art.insets')}</span>
                    {(['left', 'top', 'right', 'bottom'] as const).map((side) => (
                      <label key={side}>
                        {tr(`art.${side}` as AdminKey)}
                        <input
                          type="number"
                          min={0}
                          value={frame.insets[side]}
                          onChange={(e) =>
                            setPart('frame', {
                              ...frame,
                              insets: { ...frame.insets, [side]: Math.max(0, Math.round(Number(e.target.value) || 0)) },
                            })
                          }
                        />
                      </label>
                    ))}
                  </span>
                )}
                {goal && (
                  <label className="ad-art__mouth">
                    <span>{tr('art.mouth')}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={goal.mouthX}
                      onChange={(e) => setPart('goal', { ...goal, mouthX: Number(e.target.value) })}
                    />
                    <span dir="ltr">{goal.mouthX.toFixed(2)}</span>
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(target.current, file);
        }}
      />
    </div>
  );
}

/** Rough board composition: background, turf, nine-slice frame and both goals. */
function ArenaPreview({ art, theme }: { art: ArenaArt; theme: string }) {
  const base = themeArt(theme);
  const frame = art.frame ?? (base ? { src: '', ...base.frame } : undefined);
  const frameUrl = partUrl(art, theme, 'frame');
  const goalUrl = partUrl(art, theme, 'goal');
  const goal = art.goal ?? goalArt() ?? undefined;
  const inner = frame ? frame.w - frame.insets.left - frame.insets.right : 1;
  const unit = (px: number) => `calc(${px} * 56cqw / ${inner})`;
  return (
    <div className="ad-arena-preview" aria-label={tr('art.preview')}>
      {partUrl(art, theme, 'background') && (
        <img className="ad-arena-preview__bg" src={partUrl(art, theme, 'background')} alt="" />
      )}
      <div className="ad-arena-preview__pitch">
        {partUrl(art, theme, 'turf') && <img src={partUrl(art, theme, 'turf')} alt="" />}
        {goalUrl && goal && (
          <>
            <img
              className="ad-arena-preview__goal is-left"
              src={goalUrl}
              alt=""
              style={{ aspectRatio: `${goal.w} / ${goal.h}` }}
            />
            <img
              className="ad-arena-preview__goal is-right"
              src={goalUrl}
              alt=""
              style={{ aspectRatio: `${goal.w} / ${goal.h}` }}
            />
          </>
        )}
        {frame && frameUrl && (
          <div
            className="ad-arena-preview__frame"
            style={{
              inset: `calc(-1 * ${unit(frame.insets.top)}) calc(-1 * ${unit(frame.insets.right)}) calc(-1 * ${unit(frame.insets.bottom)}) calc(-1 * ${unit(frame.insets.left)})`,
              borderWidth: `${unit(frame.insets.top)} ${unit(frame.insets.right)} ${unit(frame.insets.bottom)} ${unit(frame.insets.left)}`,
              borderImageSource: `url("${frameUrl}")`,
              borderImageSlice: `${frame.insets.top} ${frame.insets.right} ${frame.insets.bottom} ${frame.insets.left}`,
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Economy in fixed sections; the daily cycle as a grid of day tiles. */
export function EconomyPage({ ctx }: { ctx: EditContext }) {
  useAdminLang();
  const doc = ctx.defaults.economy as Record<string, unknown> & {
    rewardedAd: Record<string, unknown>;
    features: { clubTeams: Record<string, unknown> };
    dailyRewards: Price[];
  };
  const leaf = (path: string, value: unknown, name: string) => (
    <Node key={path} value={value} path={path} name={name} depth={1} ctx={ctx} />
  );
  const dailyPath = 'economy/dailyRewards';
  const days = (ctx.draft[dailyPath] as Price[] | undefined) ?? doc.dailyRewards;
  const setDays = (next: Price[]) => ctx.onChange(dailyPath, next, doc.dailyRewards);
  return (
    <div className="dash__cards">
      <section className="ad-card">
        <h2>{tr('econ.start')}</h2>
        {leaf('economy/startingBalance', doc.startingBalance, 'startingBalance')}
        {leaf('economy/tutorialReward', doc.tutorialReward, 'tutorialReward')}
      </section>
      <section className="ad-card">
        <h2>{tr('econ.ads')}</h2>
        {leaf('economy/rewardedAd/coins', doc.rewardedAd.coins, 'coins')}
        {leaf('economy/rewardedAd/dailyCap', doc.rewardedAd.dailyCap, 'dailyCap')}
        <h2 className="ad-card__sub">
          {tr('econ.features')} · {fieldLabel('clubTeams')}
          <Tip field="clubTeams" />
        </h2>
        {leaf('economy/features/clubTeams/enabled', doc.features.clubTeams.enabled, 'enabled')}
      </section>
      <section className={`ad-card ad-card--wide${dailyPath in ctx.draft ? ' is-changed' : ''}`}>
        <h2>
          {tr('econ.daily')}
          <Tip field="dailyRewards" />
          {dailyPath in ctx.draft && (
            <button
              type="button"
              className="admin__btn admin__btn--small ad-card__reset"
              onClick={() => ctx.onChange(dailyPath, undefined, undefined)}
            >
              {tr('action.reset')}
            </button>
          )}
        </h2>
        <div className="ad-daily">
          {days.map((day, i) => (
            <div key={i} className="ad-daily__day">
              <div className="ad-daily__head">
                <b>{tr('day', { n: num(i + 1) })}</b>
                {days.length > 1 && (
                  <button
                    type="button"
                    className="admin__btn admin__btn--small"
                    aria-label={tr('action.remove', { x: tr('day', { n: num(i + 1) }) })}
                    onClick={() => setDays(days.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </div>
              {(['coins', 'gems'] as const).map((c) => (
                <label key={c} className={`ad-price__field ad-price__field--${c}`}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={day[c] ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const next: Price = { ...day };
                      if (e.target.value === '') delete next[c];
                      else next[c] = Math.max(0, Math.round(Number(e.target.value)) || 0);
                      setDays(days.map((d, j) => (j === i ? next : d)));
                    }}
                  />
                  <span>{tr(c === 'gems' ? 'price.gems' : 'price.coins')}</span>
                </label>
              ))}
            </div>
          ))}
          <button type="button" className="ad-daily__add" onClick={() => setDays([...days, { coins: 0 }])}>
            {tr('action.addDay')}
          </button>
        </div>
      </section>
    </div>
  );
}
