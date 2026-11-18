import { useCollectibleReaction } from '../ui/collectibleReaction';
import { TeamAttributes } from '../ui/TeamAttributes';
import { TrailPreview } from '../ui/TrailPreview';
import { PanelScreen } from '../ui/components';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { cosmetics, progressionConfig } from '@flickkick/config';
import { levelProgress } from '@flickkick/rules';
import { formatNumber } from '../i18n';
import { isValidDisplayName, profileStore, useLocalProfile } from '../services/localProfile';
import { connect, getOnline, linkEmail, refreshProfile, rpc, updateProfile, useOnline } from '../services/online';
import {
  Avatar,
  Dialog,
  ConfirmDialog,
  ArtImage,
  BallPreview,
  Badge,
  Button,
  Card,
  PriceTag,
  ProgressBar,
  RankBadge,
  rankForLevel,
  ScreenHeader,
  Tabs,
  TeamSwatch,
} from '../ui/components';
import {
  IconCheck,
  IconUser,
  IconHistory,
  IconGift,
  IconSchool,
  IconGear,
  IconShirt,
  IconBall,
  IconFormation,
  IconTrail,
} from '../ui/icons';
import { localOnlineEnabled } from '../services/localRanked';
import { ownsLocal, useLocalInventory } from '../services/localInventory';
import { assetUrl } from '../game/art';
import { toast } from '../ui/toast';

/** F-10: profile. Local identity and practice stats; online stats arrive with the server. */
export function ProfileScreen() {
  const { t } = useTranslation();
  const reaction = useCollectibleReaction();
  const navigate = useNavigate();
  const [replayTutorial, setReplayTutorial] = useState(false);
  const profile = useLocalProfile();
  const server = useOnline();
  const [name, setName] = useState(profile.displayName);
  const [edit, setEdit] = useState<'name' | 'avatar' | 'invite' | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const inventory = useLocalInventory();
  const xp = levelProgress(server.profile?.xp ?? profile.knownXP ?? 0, progressionConfig);
  const ownedAvatars = cosmetics.avatars.filter((item) => ownsLocal('avatars', item.id));
  const valid = isValidDisplayName(name);
  const deviceStats = localOnlineEnabled
    ? Object.values(inventory.ranked?.receipts ?? {}).reduce(
        (stats, receipt) => ({
          played: stats.played + 1,
          won: stats.won + (receipt.record.won ? 1 : 0),
          lost: stats.lost + (receipt.record.won ? 0 : 1),
          goalsFor: stats.goalsFor + receipt.record.scoreFor,
          goalsAgainst: stats.goalsAgainst + receipt.record.scoreAgainst,
        }),
        profile.practice,
      )
    : profile.practice;
  const p = server.status === 'online' && server.profile ? server.profile.stats : deviceStats;
  const winRate = p.played ? Math.round((p.won / p.played) * 100) : 0;

  return (
    <PanelScreen className="profile-screen">
      <div className="profile-heading">
        <ScreenHeader title={t('profile.title')} />
        <div className="profile-heading__actions">
          <Link
            className="icon-btn"
            to="/rewards/levels"
            aria-label={t('rewards.levelRewards')}
            title={t('rewards.levelRewards')}
          >
            <IconGift />
          </Link>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setReplayTutorial(true)}
            aria-label={t('home.tutorial')}
            title={t('home.tutorial')}
          >
            <IconSchool />
          </button>
          <Link
            className="icon-btn"
            to="/profile/history"
            aria-label={t('profile.history')}
            title={t('profile.history')}
          >
            <IconHistory />
          </Link>
          <Link className="icon-btn" to="/settings" aria-label={t('nav.settings')}>
            <IconGear />
          </Link>
        </div>
      </div>
      <ConfirmDialog
        open={replayTutorial}
        title={t('settings.replayTutorial')}
        body={t('tutorial.replayConfirm')}
        onCancel={() => setReplayTutorial(false)}
        onConfirm={() => {
          setReplayTutorial(false);
          navigate('/tutorial');
        }}
      />
      <Card className="identity-card">
        <div className="identity-card__top">
          <button
            className="avatar-edit"
            type="button"
            onClick={() => setEdit('avatar')}
            aria-label={t('profile.editAvatar')}
          >
            <Avatar id={profile.avatarId} size={84} frame="level" />
            <ArtImage className="edit-mark" src={assetUrl('lobby/edit.webp')} size={28} />
          </button>
          <div className="identity-card__name">
            <div className="identity-name-row">
              <h2>
                <bdi>{profile.displayName}</bdi>
              </h2>
              <button
                className="icon-btn identity-edit"
                type="button"
                aria-label={t('profile.editName')}
                onClick={() => {
                  setName(profile.displayName);
                  setEditError('');
                  setEdit('name');
                }}
              >
                <ArtImage src={assetUrl('lobby/edit.webp')} size={24} />
              </button>
            </div>
            <span>{t('common.levelLong', { level: formatNumber(profile.knownLevel) })}</span>
            <ProgressBar
              value={xp.current}
              max={xp.needed || 1}
              label={t('profile.xp', { current: formatNumber(xp.current), needed: formatNumber(xp.needed) })}
            />
            <small>{t('profile.xp', { current: formatNumber(xp.current), needed: formatNumber(xp.needed) })}</small>
          </div>
        </div>
        <div className="identity-code">
          <span>{t('profile.playerCode')}</span>
          <strong dir="ltr">{profile.playerCode ?? t('profile.codePending')}</strong>
        </div>
        <div className="identity-card__league">
          <div>
            <RankBadge rank={rankForLevel(profile.knownLevel)} size={68} />
          </div>
          <div>
            <TeamSwatch teamId={profile.teamId} size={68} />
            <span>{t(`teams.${profile.teamId}`)}</span>
          </div>
        </div>
        <dl className="identity-stats stat-grid">
          {(
            [
              ['played', p.played],
              ['won', p.won],
              ['lost', p.lost],
              ['goalsFor', p.goalsFor],
              ['goalsAgainst', p.goalsAgainst],
              ['winRate', `${formatNumber(winRate)}%`],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt>{t(`profile.${key}`)}</dt>
              <dd>{typeof value === 'number' ? formatNumber(value) : value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Button className="profile-invite" onClick={() => setEdit('invite')}>
        {t('referral.invite')}
      </Button>
      <Dialog open={edit === 'invite'} title={t('referral.invite')} onClose={() => !inviteBusy && setEdit(null)}>
        <p>{t('referral.description')}</p>
        <Button
          block
          disabled={inviteBusy}
          onClick={async () => {
            setInviteBusy(true);
            try {
              if (!getOnline().profile?.playerCode) await connect();
              const code = getOnline().profile?.playerCode;
              if (!code) throw new Error(t('referral.connection'));
              const url = new URL('/welcome', window.location.origin);
              url.searchParams.set('ref', code);
              const text = t('referral.shareText', { code });
              if (navigator.share) await navigator.share({ title: 'Bumper Goal', text, url: url.href });
              else {
                await navigator.clipboard.writeText(`${text}\n${url.href}`);
                toast(t('referral.copied'), 'success');
              }
            } catch (error) {
              if (!(error instanceof DOMException && error.name === 'AbortError'))
                toast(error instanceof Error ? error.message : t('errors.generic'), 'error');
            } finally {
              setInviteBusy(false);
            }
          }}
        >
          {t('referral.share')}
        </Button>
        <form
          className="screen invitation-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (inviteBusy || !/^[1-9][0-9]{7}$/.test(inviteCode)) return;
            setInviteBusy(true);
            try {
              if (getOnline().status !== 'online') await connect();
              if (getOnline().status !== 'online') throw new Error(t('referral.connection'));
              const result = await rpc<{ applied: boolean }>('referral_apply', { playerCode: inviteCode });
              await refreshProfile();
              toast(t(result.applied ? 'referral.applied' : 'referral.already'), result.applied ? 'success' : 'info');
            } catch {
              toast(t('referral.rejected'), 'error');
            } finally {
              setInviteBusy(false);
            }
          }}
        >
          <label className="field">
            <span>{t('referral.codeOptional')}</span>
            <input
              className="input"
              inputMode="numeric"
              dir="ltr"
              maxLength={8}
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
          <Button type="submit" disabled={inviteBusy || !/^[1-9][0-9]{7}$/.test(inviteCode)}>
            {t('referral.apply')}
          </Button>
        </form>
      </Dialog>
      <Dialog open={edit === 'name'} title={t('profile.editName')} onClose={() => !saving && setEdit(null)}>
        <form
          className="screen profile-name-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid || saving) return;
            setSaving(true);
            setEditError('');
            try {
              if (server.status === 'online') {
                await updateProfile({ displayName: name.trim() });
              } else {
                await saveDisplayName(name.trim());
              }
              setEdit(null);
              toast(t('profile.saved'), 'success');
            } catch (error) {
              setEditError(error instanceof Error ? error.message : t('errors.generic'));
            } finally {
              setSaving(false);
            }
          }}
        >
          <label className="field">
            <span>{t('profile.displayName')}</span>
            <input
              id="profile-name"
              className="input"
              value={name}
              maxLength={16}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={!valid}
            />
          </label>
          {!valid && <small className="field__error">{t('welcome.nameInvalid')}</small>}
          {editError && (
            <p className="field__error" role="alert">
              {editError}
            </p>
          )}
          <Button type="submit" disabled={!valid || saving}>
            {t('common.save')}
          </Button>
        </form>
      </Dialog>
      <Dialog open={edit === 'avatar'} title={t('profile.editAvatar')} onClose={() => setEdit(null)}>
        <div className="avatar-choices">
          {ownedAvatars.map((item) => (
            <button
              type="button"
              key={item.id}
              className={profile.avatarId === item.id ? 'is-active' : ''}
              aria-label={t(`avatars.${item.id}`)}
              aria-pressed={profile.avatarId === item.id}
              onClick={() => {
                void equip('avatarId', item.id);
                reaction.play(item.id);
              }}
            >
              {reaction.render(item.id)}
              <Avatar id={item.id} size={64} />
              <span>{t(`avatars.${item.id}`)}</span>
            </button>
          ))}
        </div>
      </Dialog>
    </PanelScreen>
  );
}

export { HistoryScreen } from './History';

/** Owned teams and balls, with one active choice in each category. */
export function LockerScreen() {
  const { t } = useTranslation();
  const reaction = useCollectibleReaction();
  const profile = useLocalProfile();
  const [tab, setTab] = useState<'teams' | 'balls' | 'avatars' | 'formations' | 'trails'>('teams');
  useLocalInventory();
  useOnline();
  const current =
    tab === 'teams'
      ? profile.teamId
      : tab === 'balls'
        ? profile.ballId
        : tab === 'trails'
          ? profile.trailId
          : tab === 'avatars'
            ? profile.avatarId
            : profile.formationId;
  return (
    <div className="screen shop-screen locker-screen">
      <div className="shop-heading">
        <div className="section-heading">
          <ScreenHeader title={t('nav.inventory')} />
          <Link className="btn btn--ghost" to="/shop">
            {t('nav.shop')}
          </Link>
        </div>
        <p className="section-note">{t('locker.manageOnly')}</p>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={(['teams', 'balls', 'avatars', 'formations', 'trails'] as const).map((id) => ({
            id,
            label: t(`shop.tabs.${id}`),
            icon: {
              teams: <IconShirt />,
              balls: <IconBall />,
              avatars: <IconUser />,
              formations: <IconFormation />,
              trails: <IconTrail />,
            }[id],
          }))}
        />
        {tab === 'trails' && (
          <div className="locker-trail-status">
            <span>{profile.trailId ? t(`trails.${profile.trailId}`) : t('locker.trailNone')}</span>
            {profile.trailId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  profileStore.set((p) => ({ ...p, trailId: '', pending: { ...p.pending, trailId: '' } }));
                  if (getOnline().status === 'online')
                    void updateProfile({ trailId: '' }).catch((err: Error) => toast(err.message, 'error'));
                }}
              >
                {t('locker.trailDisable')}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="shop-products" key={tab}>
        {tab === 'trails' && !cosmetics.trails.some((item) => ownsLocal('trails', item.id)) && (
          <p className="catalog-empty">{t('locker.trailEmpty')}</p>
        )}
        {cosmetics[tab]
          .filter((item) => ownsLocal(tab, item.id))
          .map((item) => (
            <Card
              key={item.id}
              className={`shop-product is-owned ${tab === 'teams' ? 'shop-product--team' : ''} ${current === item.id ? 'is-equipped' : ''}`}
            >
              {reaction.render(item.id)}
              <ItemPreview kind={tab} id={item.id} />
              <strong>{t(`${tab}.${item.id}`)}</strong>
              {tab === 'teams' && <TeamAttributes id={item.id} />}
              {current === item.id ? (
                <Badge tone="success">
                  <IconCheck size={14} /> {t('locker.equipped')}
                </Badge>
              ) : (
                <Button
                  size="sm"
                  onClick={() => {
                    reaction.play(item.id);
                    if (tab === 'trails') {
                      profileStore.set((p) => ({
                        ...p,
                        trailId: item.id,
                        pending: getOnline().status === 'online' ? { ...p.pending, trailId: item.id } : p.pending,
                      }));
                      if (getOnline().status === 'online')
                        void updateProfile({ trailId: item.id }).catch((err: Error) => toast(err.message, 'error'));
                    } else if (tab === 'formations') {
                      profileStore.set((p) => ({
                        ...p,
                        formationId: item.id,
                        pending:
                          item.price === null || getOnline().status === 'online'
                            ? { ...p.pending, formationId: item.id }
                            : p.pending,
                      }));
                      if (getOnline().status === 'online')
                        void updateProfile({ formationId: item.id }).catch((err: Error) => toast(err.message, 'error'));
                    } else {
                      void equip(tab === 'teams' ? 'teamId' : tab === 'avatars' ? 'avatarId' : 'ballId', item.id);
                    }
                  }}
                >
                  {t('locker.equip')}
                </Button>
              )}
            </Card>
          ))}
      </div>
    </div>
  );
}

export function ItemPreview({
  kind,
  id,
}: {
  kind: 'teams' | 'balls' | 'avatars' | 'formations' | 'trails';
  id: string;
}) {
  if (kind === 'trails') return <TrailPreview id={id} />;
  if (kind === 'formations') return <FormationPreview id={id} />;
  if (kind === 'avatars') return <Avatar id={id} size={56} />;
  if (kind === 'teams') return <TeamSwatch teamId={id} size={56} />;
  return <BallPreview ballId={id} size={56} />;
}

export { PriceTag };

/** Online: the server validates and stores the change. Offline: local cache only. */
async function saveDisplayName(displayName: string): Promise<void> {
  // Saved locally and queued first, so leaving the page right away never loses it;
  // the server validates when the queued change is pushed.
  profileStore.set((p) => ({ ...p, displayName, pending: { ...p.pending, displayName } }));
  if (getOnline().status === 'online') await updateProfile({ displayName });
}

async function equip(key: 'teamId' | 'ballId' | 'avatarId', id: string): Promise<void> {
  profileStore.set((p) => ({
    ...p,
    [key]: id,
    pending: cosmetics[key === 'teamId' ? 'teams' : key === 'ballId' ? 'balls' : 'avatars'].some(
      (item) => item.id === id && item.price === null,
    )
      ? { ...p.pending, [key]: id }
      : p.pending,
  }));
  if (getOnline().status === 'online') {
    try {
      await updateProfile({ [key]: id });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LinkEmailCard() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = EMAIL_PATTERN.test(email) && password.length >= 8;
  return (
    <Card>
      <h2>{t('profile.linkTitle')}</h2>
      <p className="muted">{t('profile.linkBody')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          linkEmail(email.trim(), password)
            .then(() => toast(t('profile.linkedToast'), 'success'))
            .catch((err: Error) => toast(t('profile.updateFailed', { reason: err.message }), 'error'))
            .finally(() => {
              setBusy(false);
              setPassword('');
            });
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="link-email">
            {t('profile.email')}
          </label>
          <input
            id="link-email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="link-password">
            {t('profile.password')}
          </label>
          <input
            id="link-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <small className="field__hint">{t('profile.passwordHint')}</small>
        </div>
        <Button type="submit" disabled={!valid || busy}>
          {t('profile.link')}
        </Button>
      </form>
    </Card>
  );
}

/** Portrait half-pitch: own goal at the bottom, attacking direction upwards. */
function FormationPreview({ id }: { id: string }) {
  const { t } = useTranslation();
  const formation = cosmetics.formations.find((f) => f.id === id);
  return (
    <svg className="formation-preview" viewBox="0 0 120 140" role="img" aria-label={t(`formations.${id}`)}>
      <rect x="1" y="1" width="118" height="138" rx="10" fill="#12634c" />
      {[0, 2, 4].map((i) => (
        <rect key={i} x="3" y={3 + i * 22} width="114" height="22" fill="#197657" />
      ))}
      <path
        d="M6 8H114V134H6ZM36 134V110H84V134M49 134V126H71V134M36 8a24 24 0 0 0 48 0"
        fill="none"
        stroke="#b9e8cd"
        strokeWidth="1.5"
        opacity=".75"
      />
      {formation?.positions.map(([x, y], i) => (
        <g key={i}>
          <circle cx={60 + y * 13} cy={10 - x * 18} r="8" fill="#051d3b" />
          <circle cx={60 + y * 13} cy={9 - x * 18} r="6.5" fill="#c6ff3d" stroke="#ecffad" strokeWidth="1.5" />
        </g>
      ))}
    </svg>
  );
}
