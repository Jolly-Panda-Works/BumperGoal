import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LocalSetupScreen } from './LocalSetup';
import { Button, Card, PanelScreen, ScreenHeader, Segmented } from '../ui/components';
import { useOnline } from '../services/online';
import { friendRequest, localFriendsAvailable, type Invitation } from '../services/friends';
import { Notice, toast } from '../ui/toast';
import { matchSession } from '../services/matchSession';

export function FriendsScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'local' | 'invite'>('local');
  const controls = (
    <Segmented
      label={t('friends.title')}
      value={mode}
      onChange={setMode}
      options={[
        { value: 'local', label: t('friends.sameDevice') },
        { value: 'invite', label: t('friends.invite') },
      ]}
    />
  );
  return mode === 'local' ? (
    <LocalSetupScreen controls={controls} />
  ) : (
    <PanelScreen className="friends-screen">
      <ScreenHeader title={t('friends.title')} onBack={() => navigate('/home')} />
      {controls}
      <InviteLobby />
    </PanelScreen>
  );
}

function InviteLobby() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const warned = useRef(false);
  const notifyFailure = useCallback(
    (error: unknown, warning = false) => {
      const code = error instanceof Error ? error.message : 'unavailable';
      const known = [
        'expired',
        'selfJoin',
        'used',
        'rateLimited',
        'unauthorized',
        'unavailable',
        'started',
        'busy',
      ].includes(code);
      toast(known ? t(`friends.errors.${code}`) : t('friends.failed'), warning ? 'warning' : 'error');
    },
    [t],
  );
  const [copied, setCopied] = useState(false);
  const mounted = useRef(false);
  const owned = useRef<string | null>(null);
  const ownedLocal = useRef(false);
  const entered = useRef(false);
  const cancelling = useRef(false);
  const locked = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (owned.current && !entered.current)
        void friendRequest('cancel', owned.current, ownedLocal.current).catch(() => undefined);
    };
  }, []);

  const enter = (value: Invitation) => {
    if (!value.matchId || !mounted.current || entered.current || cancelling.current) return;
    entered.current = true;
    matchSession.setSetup({
      mode: 'online',
      matchId: value.matchId,
      arena: 'park',
      friendMatch: true,
      localFriend: value.local,
    });
    navigate('/match', { replace: true });
  };
  const enterRef = useRef(enter);
  enterRef.current = enter;
  useEffect(() => {
    if (!invitation) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await friendRequest('status', invitation.code, invitation.local);
        if (cancelled) return;
        if (value.matchId && !cancelling.current) {
          enterRef.current(value);
          return;
        }
        if (Date.now() >= value.expiresAt * 1000) throw new Error('expired');
        warned.current = false;
      } catch (error) {
        if (cancelled) return;
        if (!warned.current) {
          warned.current = true;
          notifyFailure(error, true);
        }
        if (Date.now() >= invitation.expiresAt * 1000) {
          owned.current = null;
          setInvitation(null);
          return;
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [invitation, t, notifyFailure]);

  const request = async (join: boolean) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    warned.current = false;
    try {
      const value = await friendRequest(join ? 'join' : 'create', join ? code : undefined);
      if (!mounted.current) {
        if (!join) void friendRequest('cancel', value.code, value.local).catch(() => undefined);
        return;
      }
      if (join) enter(value);
      else {
        owned.current = value.code;
        ownedLocal.current = !!value.local;
        setInvitation(value);
      }
    } catch (error) {
      if (mounted.current) notifyFailure(error);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      {!localFriendsAvailable && online.status !== 'online' && (
        <Notice text={t('friends.needsConnection')} tone="warning" />
      )}
      {invitation ? (
        <Card className="friend-invitation">
          <h2>{t('friends.yourCode')}</h2>
          <strong className="friend-code" dir="ltr">
            {invitation.code}
          </strong>
          <p>{t('friends.waiting')}</p>
          <small>{t('friends.expires')}</small>
          <Button
            onClick={() => {
              void navigator.clipboard
                ?.writeText(invitation.code)
                .then(() => {
                  setCopied(true);
                  toast(t('friends.copied'), 'success');
                })
                .catch(() => {
                  setCopied(false);
                  toast(t('friends.copyFailed'), 'warning');
                });
            }}
          >
            {t(copied ? 'friends.copied' : 'friends.copy')}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              cancelling.current = true;
              setBusy(true);
              try {
                await friendRequest('cancel', invitation.code, invitation.local);
                owned.current = null;
                setInvitation(null);
              } catch (error) {
                notifyFailure(error);
              } finally {
                cancelling.current = false;
                if (mounted.current) setBusy(false);
              }
            }}
          >
            {t('common.cancel')}
          </Button>
        </Card>
      ) : (
        <>
          <Card className="friend-invitation">
            <h2>{t('friends.invite')}</h2>
            <p>{t('friends.createHint')}</p>
            <Button disabled={busy} onClick={() => void request(false)}>
              {t('friends.create')}
            </Button>
          </Card>
          <Card className="friend-invitation">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void request(true);
              }}
            >
              <label className="field">
                <span>{t('friends.enterCode')}</span>
                <input
                  className="input"
                  value={code}
                  dir="ltr"
                  maxLength={12}
                  autoComplete="off"
                  onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^0-9A-F]/g, ''))}
                />
              </label>
              <Button type="submit" disabled={busy || !/^[0-9A-F]{12}$/.test(code)}>
                {t('friends.join')}
              </Button>
            </form>
          </Card>
        </>
      )}
    </>
  );
}
