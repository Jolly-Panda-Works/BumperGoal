import { Notice } from '../ui/toast';
import { BOT_SEARCH_MS, localOnlineEnabled } from '../services/localRanked';
import { localInventory } from '../services/localInventory';
import { profileForLevel } from '@flickkick/rules';
import { PanelScreen } from '../ui/components';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { arenaName } from '../i18n/arenaName';
import { useNavigate, useSearchParams } from 'react-router';
import { arenaPrize, arenasConfig, cosmetics } from '@flickkick/config';
import { uiUrl } from '../game/art';
import { formatNumber } from '../i18n';
import { matchSession } from '../services/matchSession';
import { getOnline, getSocket, onSocket, rpc } from '../services/online';
import { Avatar, Button, Card, PriceTag, ScreenHeader, ArtImage } from '../ui/components';
import { useSettings } from '../services/settings';
import { useLocalProfile } from '../services/localProfile';

interface StartResponse {
  searchId?: string;
  query?: string;
  props?: Record<string, string>;
  timeoutMs?: number;
  resumeMatchId?: string;
}

export interface MatchPreview {
  opponent: { name: string; avatarId: string; level: number; isBot: boolean };
  arena: string;
  entryFee: number;
  prize: number;
  started: boolean;
}
type Phase =
  | { kind: 'starting' }
  | { kind: 'searching'; startedAt: number; timeoutMs: number }
  | { kind: 'resolving' }
  | { kind: 'found'; matchId: string; opponent: 'human' | 'bot' | 'resume'; at: number; preview: MatchPreview }
  | { kind: 'error'; message: string };

const COUNTDOWN_MS = { human: 3000, bot: 3000, resume: 600 };

/**
 * F-06: online matchmaking. The 10 s bot fallback is measured and decided by
 * the server (mm_start arms the timer); this screen only shows what happens.
 */
export function MatchmakingScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const arena = arenasConfig.arenas.find((a) => a.id === params.get('arena')) ?? arenasConfig.arenas[0]!;
  const profile = useLocalProfile();
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const search = useRef<{ searchId?: string; ticket?: string; done: boolean; cancelled: boolean; entering: boolean }>({
    done: false,
    cancelled: false,
    entering: false,
  });

  useEffect(() => {
    const ctl = {
      done: false,
      cancelled: false,
      entering: false,
      searchId: undefined as string | undefined,
      ticket: undefined as string | undefined,
    };
    search.current = ctl;
    if (localOnlineEnabled && getOnline().status !== 'online') {
      if (profile.knownLevel < arena.minLevel || localInventory.get().coins < arena.entryFee) {
        setPhase({ kind: 'error', message: t('online.notEnoughCoins') });
        return;
      }
      setPhase({ kind: 'searching', startedAt: Date.now(), timeoutMs: BOT_SEARCH_MS });
      const timer = window.setTimeout(() => {
        if (ctl.cancelled) return;
        ctl.done = true;
        setPhase({
          kind: 'found',
          matchId: `local-ranked-${crypto.randomUUID()}`,
          opponent: 'bot',
          at: Date.now(),
          preview: {
            arena: arena.id,
            entryFee: arena.entryFee,
            prize: arenaPrize(arena),
            started: false,
            opponent: {
              name: ['Nova', 'Atlas', 'Blaze', 'Orion', 'Rio', 'Sky'][Math.floor(Math.random() * 6)]!,
              avatarId: cosmetics.avatars[Math.floor(Math.random() * cosmetics.avatars.length)]!.id,
              level: profile.knownLevel,
              isBot: true,
            },
          },
        });
      }, BOT_SEARCH_MS);
      return () => {
        window.clearTimeout(timer);
        ctl.cancelled = true;
      };
    }
    const unsubs: (() => void)[] = [];
    let poll: number | undefined;

    const found = async (matchId: string, opponent: 'human' | 'bot' | 'resume') => {
      if (ctl.done) return;
      ctl.done = true;
      window.clearInterval(poll);
      if (ctl.ticket)
        void getSocket()
          .then((s) => s.removeMatchmaker(ctl.ticket!))
          .catch(() => undefined);
      setPhase({ kind: 'resolving' });
      try {
        const preview = await rpc<MatchPreview>('mm_preview', { matchId });
        if (!ctl.cancelled) setPhase({ kind: 'found', matchId, opponent, preview, at: Date.now() });
      } catch (err) {
        if (!ctl.cancelled) setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    };

    // Deferred: React StrictMode's throwaway mount is cleaned up before this runs,
    // so only one search is ever started per screen.
    const startTimer = window.setTimeout(async () => {
      try {
        const res = await rpc<StartResponse>('mm_start', { arena: arena.id });
        if (ctl.done) {
          if (res.searchId) void rpc('mm_cancel', { searchId: res.searchId }).catch(() => undefined);
          return;
        }
        ctl.searchId = res.searchId;
        if (res.resumeMatchId) return found(res.resumeMatchId, 'resume');
        unsubs.push(
          onSocket('matched', (m) => found(m.matchId, 'human')),
          onSocket('notification', (n) => {
            if (n.code === 101 && n.content.searchId === ctl.searchId) found(String(n.content.matchId), 'bot');
          }),
        );
        const socket = await getSocket();
        const ticket = await socket.addMatchmaker(res.query!, 2, 2, res.props);
        if (ctl.done) {
          void socket.removeMatchmaker(ticket.ticket).catch(() => undefined);
          return;
        }
        ctl.ticket = ticket.ticket;
        setPhase({ kind: 'searching', startedAt: Date.now(), timeoutMs: res.timeoutMs ?? BOT_SEARCH_MS });
        // Safety net for a missed notification: ask the server where the search ended up.
        poll = window.setInterval(async () => {
          const st = await rpc<{ state: string; matchId: string; opponent: string }>('mm_status', {
            searchId: ctl.searchId,
          }).catch(() => null);
          if (st?.matchId) found(st.matchId, st.opponent === 'bot' ? 'bot' : 'human');
          else if (st?.state === 'cancelled' && !ctl.done) {
            // Superseded on the server (e.g. a newer search from this account): start over.
            ctl.done = true;
            setAttempt((a) => a + 1);
          }
        }, 4000);
      } catch (err) {
        if (!ctl.done) setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }, 0);

    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(poll);
      unsubs.forEach((u) => u());
      ctl.cancelled = true;
      if (!ctl.entering) {
        ctl.done = true;
        if (ctl.searchId) void rpc('mm_cancel', { searchId: ctl.searchId }).catch(() => undefined);
        if (ctl.ticket)
          void getSocket()
            .then((s) => s.removeMatchmaker(ctl.ticket!))
            .catch(() => undefined);
      }
    };
  }, [arena, attempt, profile.knownLevel, t]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  // Short countdown, then into the match (cancel still possible during it).
  useEffect(() => {
    if (phase.kind !== 'found') return;
    const id = window.setTimeout(() => {
      if (search.current.cancelled) return;
      search.current.entering = true;
      matchSession.setSetup({
        mode: 'online',
        matchId: phase.matchId,
        arena: phase.preview.arena,
        localBot: localOnlineEnabled && phase.matchId.startsWith('local-ranked-'),
        aiProfileId: profileForLevel(profile.knownLevel).id,
        names: [profile.displayName, phase.preview.opponent.name],
        opponentAvatarId: phase.preview.opponent.isBot ? phase.preview.opponent.avatarId : undefined,
        teams: [
          profile.teamId,
          cosmetics.teams.filter((team) => team.id !== profile.teamId)[
            Math.floor(Math.random() * (cosmetics.teams.length - 1))
          ]!.id,
        ],
      });
      navigate('/match', { replace: true });
    }, COUNTDOWN_MS[phase.opponent]);
    return () => window.clearTimeout(id);
  }, [phase, arena.id, navigate, profile.knownLevel, profile.displayName, profile.teamId]);

  const cancel = () => {
    search.current.cancelled = true;
    search.current.done = true;
    navigate('/play/online', { replace: true });
  };

  return (
    <PanelScreen className="matchmaking">
      <ScreenHeader title={t('mm.title')} onBack={cancel} />
      <Card className="mm-card mm-showdown">
        <MatchmakingStage
          player={{ name: profile.displayName, avatarId: profile.avatarId, level: profile.knownLevel }}
          preview={phase.kind === 'found' ? phase.preview : undefined}
          searching={phase.kind === 'starting' || phase.kind === 'searching' || phase.kind === 'resolving'}
          entryFee={arena.entryFee}
          prize={arenaPrize(arena)}
          arenaId={arena.id}
        />
        <div className="mm-status" role="status" aria-live="polite">
          {phase.kind === 'starting' && <p>{t('mm.starting')}</p>}
          {phase.kind === 'searching' && (
            <>
              <p>{t('mm.searching')}</p>
              <p className="muted">
                {t('mm.elapsed', { s: formatNumber(Math.max(0, Math.floor((now - phase.startedAt) / 1000))) })}
              </p>
            </>
          )}
          {phase.kind === 'resolving' && <p>{t('mm.resolving')}</p>}
          {phase.kind === 'found' && (
            <>
              <h2>
                {t(
                  phase.preview.started ? 'mm.resume' : phase.preview.opponent.isBot ? 'mm.foundBot' : 'mm.foundHuman',
                )}
              </h2>
              <p className="muted">
                {t('mm.startingIn', {
                  s: formatNumber(Math.max(0, Math.ceil((COUNTDOWN_MS[phase.opponent] - (now - phase.at)) / 1000))),
                })}
              </p>
            </>
          )}
        </div>
        {phase.kind === 'error' && (
          <div className="mm-error">
            <Notice text={phase.message} tone="error" />
            <Button
              size="sm"
              onClick={() => {
                setPhase({ kind: 'starting' });
                setAttempt((a) => a + 1);
              }}
            >
              {t('common.retry')}
            </Button>
          </div>
        )}
      </Card>
      <Button variant="ghost" onClick={cancel}>
        {t('common.cancel')}
      </Button>
    </PanelScreen>
  );
}

const SCAN_NAMES = ['Nova', 'Aria', 'Leo', 'Sami', 'Zara', 'Rayan', 'Alex', 'Nika'];
const SCAN_AVATARS = cosmetics.avatars.filter((a) => a.id !== 'bot');
/** Presentation only: cycling candidates are loading art; only the server preview identifies an opponent. */
export function MatchmakingStage({
  player,
  preview,
  searching,
  entryFee,
  prize,
  arenaId,
}: {
  player: { name: string; avatarId: string; level: number };
  preview?: MatchPreview;
  searching: boolean;
  entryFee: number;
  prize: number;
  arenaId: string;
}) {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const [candidate, setCandidate] = useState(0);
  useEffect(() => {
    if (!searching || settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setCandidate((i) => i + 1), 420);
    return () => window.clearInterval(timer);
  }, [searching, settings.reducedMotion]);
  const collecting = !!preview && !preview.started;
  return (
    <div className={`mm-stage ${searching ? 'is-searching' : ''} ${collecting ? 'is-collecting' : ''}`}>
      <h2 className="mm-arena-name">{arenaName(preview?.arena ?? arenaId, t, i18n.language)}</h2>
      <div className="mm-versus" dir="ltr">
        <div className="mm-player mm-player--self">
          <Avatar id={player.avatarId} size={104} frame="level" />
          <bdi>{player.name}</bdi>
          <span className="muted">{t('common.levelLong', { level: formatNumber(player.level) })}</span>
          {preview && (
            <div className="mm-entry">
              <PriceTag price={{ coins: preview.entryFee }} />
            </div>
          )}
        </div>
        <span className="mm-vs">
          <ArtImage className="mm-vs__art" src={uiUrl('vs')} fallback="VS" />
          <span className="visually-hidden">VS</span>
        </span>
        <div className="mm-player mm-player--opponent">
          {preview ? (
            <>
              <Avatar id={preview.opponent.avatarId} size={104} frame="level" />
              <bdi>{preview.opponent.name}</bdi>
              <span className="muted">{t('common.levelLong', { level: formatNumber(preview.opponent.level) })}</span>
              <div className="mm-entry">
                <PriceTag price={{ coins: preview.entryFee }} />
              </div>
            </>
          ) : (
            <div className="mm-reel" aria-hidden="true">
              <div key={candidate} className={searching ? 'mm-candidate' : 'mm-candidate mm-candidate--idle'}>
                <Avatar
                  id={searching ? SCAN_AVATARS[candidate % SCAN_AVATARS.length]!.id : 'unknown'}
                  size={104}
                  frame="level"
                />
                <bdi>{searching ? SCAN_NAMES[candidate % SCAN_NAMES.length] : t('mm.opponent')}</bdi>
                <span className="muted">•••</span>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mm-pool" aria-label={t('online.prize')}>
        <div className="mm-coin-flight" aria-hidden="true">
          {collecting &&
            Array.from({ length: 16 }, (_, i) => (
              <ArtImage
                key={i}
                src={uiUrl('coin')}
                className={`mm-flying-coin ${i % 2 ? 'from-right' : 'from-left'}`}
              />
            ))}
        </div>
        <span>{t(collecting ? 'mm.prizePool' : 'online.prize')}</span>
        <PriceTag price={{ coins: preview?.prize ?? prize }} />
      </div>
      {!preview && (
        <p className="mm-entry-note">
          {t('online.entryFee')} <PriceTag price={{ coins: entryFee }} />
        </p>
      )}
    </div>
  );
}
