import { useCallback, useEffect, useRef, useState } from 'react';
import { WorldProvider, useTrait } from 'koota/react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { cosmetics, rulesConfig, teamTurnTime } from '@flickkick/config';
import { profileById, type MatchEvent, type MatchState, type PlayerInfo, type Side } from '@flickkick/rules';
import { createAIClient } from '../game/aiClient';
import { themeOf } from '../game/art';
import { GameHost } from '../game/GameHost';
import { MatchController } from '../game/MatchController';
import { OnlineMatchController } from '../game/OnlineMatchController';
import type { MatchDriver } from '../game/driver';
import { connect, refreshProfile } from '../services/online';
import { HudTrait, MatchTrait } from '../game/ecs/traits';
import { resolveTeams } from '../game/theme';
import { formatNumber } from '../i18n';
import { beginLocalRanked, settleLocalRanked, settleLocalPractice } from '../services/localRanked';
import { ownsLocal } from '../services/localInventory';
import { profileStore, recordLocalMatch, useLocalProfile } from '../services/localProfile';
import { matchSession, type MatchSetup } from '../services/matchSession';
import { settingsStore, useSettings } from '../services/settings';
import { useVoice, type VoicePeer, type VoiceState } from '../services/voice';
import { voiceChat } from '../services/voiceChat';
import { AudioUnlock, MicButton, VoiceBadge } from '../ui/VoiceControls';
import { VoicePeerDialog } from '../ui/VoicePeerDialog';
import { enterMatchMode, leaveMatchMode } from '../services/device';
import { createSim } from '../services/sim';
import { Avatar, Button, ConfirmDialog, Dialog, ErrorState, IconButton, Spinner, Toggle } from '../ui/components';
import { IconPause } from '../ui/icons';
import { Notice, toast } from '../ui/toast';

const BOT_NAME = 'FlickBot';
const END_DELAY_MS = 1600;

function buildController(setup: MatchSetup, sim: Awaited<ReturnType<typeof createSim>>): MatchController {
  if (setup.mode === 'online' && !setup.localBot) throw new Error('online matches use OnlineMatchController');
  const profile = profileStore.get();
  const freeTeams = cosmetics.teams.filter((t) => t.price === null).map((t) => t.id);
  const opponentTeam = freeTeams.find((id) => id !== profile.teamId) ?? freeTeams[0]!;
  const [, right] = resolveTeams(setup.teams?.[0] ?? profile.teamId, setup.teams?.[1] ?? opponentTeam);
  const me: Omit<PlayerInfo, 'side'> = {
    id: 'local',
    displayName: setup.names?.[0] ?? profile.displayName,
    level: profile.knownLevel,
    teamId: setup.teams?.[0] ?? profile.teamId,
    isBot: false,
  };
  const formation =
    cosmetics.formations.find((f) => f.id === profile.formationId && ownsLocal('formations', f.id)) ??
    cosmetics.formations[0]!;
  const selectedRules =
    setup.mode === 'tutorial'
      ? rulesConfig
      : { ...rulesConfig, formation: formation.positions, opponentFormation: rulesConfig.formation };
  const seed = (crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now()) >>> 0;
  const matchId = setup.localBot ? setup.matchId! : `local-${Date.now().toString(36)}`;

  if (setup.mode === 'local_pvp') {
    return new MatchController({
      rules: selectedRules,
      matchId,
      mode: 'local_pvp',
      sim,
      seed,
      humanSides: ['L', 'R'],
      players: [
        me,
        { id: 'local-2', displayName: setup.names?.[1] ?? 'Player 2', level: 1, teamId: right.id, isBot: false },
      ],
    });
  }
  const aiProfile = profileById(setup.aiProfileId ?? 'rookie');
  return new MatchController({
    rules: selectedRules,
    matchId,
    mode: setup.mode === 'online' ? 'local_ai' : setup.mode,
    sim,
    seed,
    humanSides: ['L'],
    ai: { side: 'R', profile: aiProfile, client: createAIClient(sim) },
    players: [
      me,
      {
        id: `bot-${aiProfile.id}`,
        displayName: setup.names?.[1] ?? BOT_NAME,
        level: profile.knownLevel,
        teamId: right.id,
        isBot: true,
      },
    ],
    turnTimeMs: setup.mode === 'tutorial' ? null : rulesConfig.turnTimeMs,
  });
}

/** F-07: the match. React renders the HUD; Phaser renders the board. */
export function MatchScreen({ coach }: { coach?: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setup = matchSession.getSetup();
  const ballId = useLocalProfile().ballId;
  const [controller, setController] = useState<MatchDriver | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Phones: fullscreen + landscape for the match, released when leaving it.
  useEffect(() => {
    void enterMatchMode();
    return () => leaveMatchMode();
  }, []);

  useEffect(() => {
    if (!setup) return;
    let disposed = false;
    let created: MatchDriver | null = null;
    setError(null);
    createSim()
      .then(async (sim) => {
        if (disposed) return;
        if (setup.mode === 'online' && !setup.localBot) {
          let transport;
          if (import.meta.env.DEV && setup.localFriend) {
            const { localMatchTransport } = await import('../dev/localFriendsClient');
            transport = localMatchTransport(setup.matchId!);
          }
          const online = new OnlineMatchController(setup.matchId!, sim, transport);
          created = online;
          await online.join();
          if (disposed) return;
          online.signals.on('aborted', () => {
            toast(t('online.aborted'), 'error');
            navigate('/play/online', { replace: true });
          });
          setController(online);
          return;
        }
        created = buildController(setup, sim);
        if (setup.localBot) beginLocalRanked(setup.matchId!, setup.arena!);
        setController(created);
      })
      .catch((err: unknown) => {
        if (!disposed) setError(err instanceof Error ? err.message : 'error');
      });
    return () => {
      disposed = true;
      created?.dispose();
      setController(null);
    };
  }, [setup, attempt, navigate, t]);

  if (!setup) return <Navigate to="/home" replace />;
  if (error)
    return (
      <div className="match match--center">
        <ErrorState
          title={t(setup.mode === 'online' ? 'online.joinFailed' : 'match.loadError')}
          body={setup.mode === 'online' ? error : undefined}
          onRetry={() => setAttempt((a) => a + 1)}
        />
        <Button variant="ghost" onClick={() => navigate('/home')}>
          {t('result.home')}
        </Button>
      </div>
    );
  if (!controller)
    return (
      <div className="match match--center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  return (
    <WorldProvider world={controller.world}>
      <MatchView key={controller.current.matchId} controller={controller} setup={setup} ballId={ballId} coach={coach} />
    </WorldProvider>
  );
}

function MatchView({
  controller,
  setup,
  ballId,
  coach,
}: {
  controller: MatchDriver;
  setup: MatchSetup;
  ballId: string;
  coach?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // HUD reads the ECS world traits written by the controller.
  const state = useTrait(controller.world, MatchTrait)?.state ?? controller.current;
  const hud = useTrait(controller.world, HudTrait) ?? {
    thinkingSide: null,
    turnEndsAt: null,
    paused: false,
    canAim: false,
    reconnecting: false,
  };
  const [banner, setBanner] = useState<{ text: string; kind: 'goal' | 'info' } | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [voiceMenu, setVoiceMenu] = useState<string | null>(null);
  const voice = useVoice(voiceChat);
  const voiceOn = useSettings().voiceChat;
  const onlineMatchId = controller instanceof OnlineMatchController && !setup.localFriend ? controller.matchId : null;
  const recorded = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Window shake: the scene asks, the page around the board moves.
  const screenShake = useCallback((strength: number) => {
    const el = rootRef.current;
    if (!el || typeof el.animate !== 'function') return;
    const a = 3 + strength * 9;
    el.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: `translate(${-a}px, ${a * 0.6}px) rotate(-0.35deg)` },
        { transform: `translate(${a * 0.8}px, ${-a * 0.5}px) rotate(0.3deg)` },
        { transform: `translate(${-a * 0.5}px, ${a * 0.3}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 240 + strength * 220, easing: 'ease-out' },
    );
  }, []);

  const nameOf = useCallback((side: Side) => controller.playerOf(side).displayName, [controller]);

  const finish = useCallback(
    (final: MatchState) => {
      if (recorded.current) return;
      recorded.current = true;
      const result = final.result!;
      let localRewards;
      const mySide: Side = controller instanceof OnlineMatchController ? controller.side : 'L';
      if (controller instanceof OnlineMatchController && !setup.localFriend) {
        // Server-recorded: rewards come from the server, never computed here.
        // A connection lost during the match must not leave the old XP on screen.
        void refreshProfile().catch(() => connect());
      } else if (setup.localFriend) {
        // Development invitations are unranked and never touch the server account.
      } else if (setup.localBot) {
        localRewards = settleLocalRanked(final, controller.statistics);
      } else if (setup.mode === 'tutorial') {
        profileStore.set({ tutorialDone: true });
      } else {
        // Local results: practice record only, never online rewards (PRODUCT_SPEC §4).
        const won = result.winner === 'L';
        recordLocalMatch({
          id: final.matchId,
          playerName: final.players[0].displayName,
          playerAvatarId: profileStore.get().avatarId,
          opponentAvatarId: setup.opponentAvatarId ?? (final.players[1].isBot ? 'bot' : undefined),
          teamId: final.players[0].teamId,
          opponentTeamId: final.players[1].teamId,
          playerSide: 'L',
          statistics: controller.statistics,
          endedAt: Date.now(),
          mode: final.mode,
          opponentName: final.players[1].displayName,
          opponentIsBot: final.players[1].isBot,
          aiProfile: setup.aiProfileId ?? null,
          scoreFor: final.score.L,
          scoreAgainst: final.score.R,
          won: setup.mode === 'local_pvp' ? result.winner === 'L' : won,
          reason: result.reason,
        });
      }
      if (!controller.online && !setup.localBot) localRewards = settleLocalPractice(final);
      matchSession.setOutcome({
        setup,
        statistics: controller.statistics,
        state: final,
        side: mySide,
        rewards: controller instanceof OnlineMatchController ? controller.finalRewards : localRewards,
      });
      window.setTimeout(
        () => navigate(setup.mode === 'tutorial' ? '/home' : '/result', { replace: true }),
        END_DELAY_MS,
      );
    },
    [navigate, setup, controller],
  );

  useEffect(() => {
    const showBanner = (text: string, kind: 'goal' | 'info', ms: number) => {
      setBanner({ text, kind });
      window.setTimeout(() => setBanner((b) => (b?.text === text ? null : b)), ms);
    };
    const offEvents = controller.bus.on('events', (events: MatchEvent[]) => {
      for (const e of events) {
        if (e.type === 'goal') showBanner(e.ownGoal ? t('match.ownGoal') : t('match.goal'), 'goal', 3000);
        if (e.type === 'sudden_death') showBanner(t('match.suddenDeath'), 'info', 2200);
        if (e.type === 'timeout') toast(t('match.timeout'));
      }
    });
    const offEnded = controller.bus.on('ended', finish);
    const offRejected = controller.bus.on('rejected', (reason) => {
      if (reason === 'not_your_disc') toast(t('match.notYourDisc'), 'error', 1500);
    });
    controller.start();
    showBanner(t('match.goalsToWin', { n: formatNumber(controller.current.goalsToWin) }), 'info', 2200);
    return () => {
      offEvents();
      offEnded();
      offRejected();
    };
  }, [controller, finish, t]);

  useEffect(() => {
    if (!onlineMatchId) return;
    if (voiceOn) void voiceChat.start(onlineMatchId);
    else void voiceChat.stop();
  }, [onlineMatchId, voiceOn]);

  useEffect(() => {
    if (!voice.audioBlocked) return;
    const resume = () => void voiceChat.resumeAudio();
    window.addEventListener('pointerdown', resume, { once: true });
    return () => window.removeEventListener('pointerdown', resume);
  }, [voice.audioBlocked]);

  useEffect(() => {
    if (!onlineMatchId) return;
    const off = voiceChat.onNotice((notice) => {
      if (notice === 'removed') toast(t('voice.removed'), 'error');
      if (notice === 'mutedByServer') toast(t('voice.mutedByServer'), 'error');
      if (notice === 'micDenied') toast(t('voice.micDenied'), 'error', 4000);
      if (notice === 'reportSent') toast(t('voice.reportSent'));
      if (notice === 'reportFailed') toast(t('voice.reportFailed'), 'error');
    });
    return () => {
      off();
      void voiceChat.stop();
    };
  }, [onlineMatchId, t]);

  // Read-only inspection hook for end-to-end tests; never present in production builds.
  useEffect(() => {
    if (import.meta.env.PROD && import.meta.env.VITE_E2E_HOOKS !== '1') return;
    const w = window as unknown as Record<string, unknown>;
    w.__fkMatch = {
      state: () => controller.current,
      canAim: () => controller.canAim(),
      voice: () => voiceChat.getSnapshot(),
    };
    return () => {
      delete w.__fkMatch;
    };
  }, [controller]);

  // Pause when the tab is hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        controller.pause();
        setPauseOpen(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [controller]);

  const openPause = () => {
    controller.pause();
    setPauseOpen(true);
  };
  const closePause = () => {
    setPauseOpen(false);
    controller.resume();
  };

  const turnSide = state.turn.side;
  const humanTurn = controller.isHuman(turnSide);
  const status =
    state.phase === 'ENDED'
      ? t('result.winnerIs', { name: nameOf(state.result!.winner) })
      : hud.thinkingSide
        ? t('match.thinking', { name: nameOf(hud.thinkingSide) })
        : state.phase === 'SIMULATING'
          ? ''
          : humanTurn && setup.mode !== 'local_pvp'
            ? t('match.yourTurn')
            : t('match.turnOf', { name: nameOf(turnSide) });

  const [turnNotice, setTurnNotice] = useState('');
  useEffect(() => {
    if (state.phase !== 'AWAIT_SHOT' || !status || banner?.kind === 'goal') {
      setTurnNotice('');
      return;
    }
    setTurnNotice(status);
    const timer = window.setTimeout(() => setTurnNotice(''), 1400);
    return () => window.clearTimeout(timer);
  }, [state.turn.seq, state.phase, status, banner?.kind]);

  const voiceReady = voice.status === 'ready';
  const menuPeer = voiceMenu ? voice.peers.find((p) => p.id === voiceMenu) : undefined;
  const voiceProps = (player: PlayerInfo) => voiceFor(voice, player, setVoiceMenu);

  return (
    <div className="match" ref={rootRef}>
      <div className={`hud ${voiceReady ? 'hud--voice' : ''}`} dir="ltr">
        <PlayerPanel
          player={state.players[0]}
          mine={controller.isHuman('L')}
          active={turnSide === 'L' && state.phase !== 'ENDED'}
          hud={hud}
          {...voiceProps(state.players[0])}
        />
        <div className="hud__score" aria-live="polite">
          <span>{formatNumber(state.score.L)}</span>
          <span className="hud__dash">:</span>
          <span>{formatNumber(state.score.R)}</span>
        </div>
        <PlayerPanel
          player={state.players[1]}
          mine={controller.isHuman('R') && !controller.isHuman('L')}
          active={turnSide === 'R' && state.phase !== 'ENDED'}
          hud={hud}
          right
          avatarId={setup.opponentAvatarId}
          arena={setup.mode === 'online'}
          {...voiceProps(state.players[1])}
        />
        {voiceReady && (
          <MicButton
            mic={voice.mic}
            speaking={voice.me?.speaking ?? false}
            onToggle={() => void voiceChat.toggleMic()}
          />
        )}
        <IconButton label={t('match.pause')} onClick={openPause} className="hud__pause">
          <IconPause />
        </IconButton>
      </div>
      {voiceReady && voice.audioBlocked && <AudioUnlock onUnlock={() => void voiceChat.resumeAudio()} />}
      <div className="match__board">
        {turnNotice && banner?.kind !== 'goal' && (
          <div key={`${state.turn.seq}-${turnNotice}`} className="match-turn-notice" role="status">
            <bdi>{turnNotice}</bdi>
          </div>
        )}
        <GameHost
          init={{
            controller,
            ballId,
            trailIds: controller.online
              ? controller.trailIds
              : setup.mode === 'tutorial'
                ? {}
                : { L: ownsLocal('trails', profileStore.get().trailId) ? profileStore.get().trailId : '' },
            bottomSide: controller instanceof OnlineMatchController ? controller.side : 'L',
            theme: themeOf(setup.arena),
            onScreenShake: screenShake,
            onInvalidPress: (reason) =>
              toast(t(reason === 'not_your_disc' ? 'match.notYourDisc' : 'match.notYourTurn'), 'error', 1400),
          }}
        />
        {banner && (
          <div
            // With effects on, the board shows its own GOAL! slam; keep this for screen readers.
            className={`match-banner match-banner--${banner.kind} ${banner.kind === 'goal' && !settingsStore.get().reducedMotion ? 'visually-hidden' : ''}`}
            role="status"
          >
            {banner.text}
          </div>
        )}
        {coach}
        {hud.reconnecting && (
          <div className="match-banner match-banner--info" role="status">
            {t('match.reconnecting')}
          </div>
        )}
      </div>
      <Dialog
        open={pauseOpen}
        title={controller.online ? t('match.menu') : t('match.paused')}
        onClose={closePause}
        actions={
          <>
            <Button variant="danger" onClick={() => setConfirmLeave(true)}>
              {t('match.forfeit')}
            </Button>
            <Button onClick={closePause}>{controller.online ? t('match.backToMatch') : t('match.resume')}</Button>
          </>
        }
      >
        {controller.online && <Notice text={t('match.onlineNoPause')} tone="warning" />}
        <PauseQuickSettings />
      </Dialog>
      {menuPeer && (
        <VoicePeerDialog
          open
          peer={menuPeer}
          name={state.players.find((p) => p.id === menuPeer.id)?.displayName ?? menuPeer.name}
          reported={voice.reported.includes(menuPeer.id)}
          onClose={() => setVoiceMenu(null)}
          onSilence={(on) => voiceChat.silence(menuPeer.id, on)}
          onReport={(reason) => voiceChat.report(menuPeer.id, reason)}
        />
      )}
      <ConfirmDialog
        open={confirmLeave}
        danger
        title={t('match.forfeitTitle')}
        body={t('match.forfeitBody')}
        confirmLabel={t('match.forfeit')}
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          setPauseOpen(false);
          if (setup.mode === 'tutorial') {
            profileStore.set({ tutorialDone: true });
            navigate('/home', { replace: true });
            return;
          }
          controller.forfeit(
            controller instanceof OnlineMatchController ? controller.side : setup.mode === 'local_pvp' ? turnSide : 'L',
          );
        }}
      />
    </div>
  );
}

function voiceFor(
  voice: VoiceState,
  player: PlayerInfo,
  openMenu: (id: string) => void,
): { voice?: VoicePeer | null; onVoiceMenu?: () => void } {
  if (voice.status !== 'ready') return {};
  if (voice.me?.id === player.id) return { voice: voice.me };
  const peer = voice.peers.find((p) => p.id === player.id) ?? null;
  return peer ? { voice: peer, onVoiceMenu: () => openMenu(peer.id) } : {};
}

function PauseQuickSettings() {
  const { t } = useTranslation();
  const [s, setS] = useState(settingsStore.get());
  useEffect(() => settingsStore.subscribe(() => setS(settingsStore.get())), []);
  return (
    <div className="stack">
      <Toggle label={t('settings.mute')} checked={s.muted} onChange={(muted) => settingsStore.set({ muted })} />
      <Toggle
        label={t('settings.aimGuide')}
        checked={s.aimGuide}
        onChange={(aimGuide) => settingsStore.set({ aimGuide })}
      />
    </div>
  );
}

function PlayerPanel({
  player,
  mine,
  active,
  hud,
  right,
  avatarId,
  arena,
  voice,
  onVoiceMenu,
}: {
  voice?: VoicePeer | null;
  onVoiceMenu?: () => void;
  player: PlayerInfo;
  mine?: boolean;
  active: boolean;
  hud: { turnEndsAt: number | null; paused: boolean };
  right?: boolean;
  avatarId?: string;
  /** Arena opponents all show their level, automated or not. */
  arena?: boolean;
}) {
  const { t } = useTranslation();
  const profileAvatar = useLocalProfile().avatarId;
  const avatar = (
    <Avatar
      id={avatarId ?? (player.isBot ? 'bot' : mine || player.id === 'local' ? profileAvatar : 'avatar_owl')}
      size={44}
    />
  );
  return (
    <div className={`hud-player ${right ? 'hud-player--right' : ''} ${active ? 'is-active' : ''}`}>
      <div className={`hud-player__avatar ${voice?.speaking && !voice.silenced ? 'is-speaking' : ''}`}>
        {onVoiceMenu ? (
          <button
            type="button"
            className="hud-player__voice"
            aria-label={t('voice.options', { name: player.displayName })}
            aria-haspopup="dialog"
            onClick={onVoiceMenu}
            data-testid="voice-peer"
          >
            {avatar}
          </button>
        ) : (
          avatar
        )}
        <VoiceBadge peer={voice ?? null} />
        {active && (
          <TurnTimer
            endsAt={hud.turnEndsAt}
            paused={hud.paused}
            duration={teamTurnTime(player.teamId, rulesConfig.turnTimeMs)}
          />
        )}
      </div>
      <div className="hud-player__info">
        <bdi className="hud-player__name">{player.displayName}</bdi>
        {(!player.isBot || arena) && (
          <span className="hud-player__meta">{t('common.level', { level: formatNumber(player.level) })}</span>
        )}
      </div>
    </div>
  );
}

function TurnTimer({ endsAt, paused, duration }: { endsAt: number | null; paused: boolean; duration: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (endsAt === null || paused) return;
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, [endsAt, paused]);
  if (endsAt === null) return null;
  const remaining = Math.max(0, endsAt - now);
  const fraction = Math.min(1, remaining / duration);
  const r = 25;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className={`turn-timer ${remaining < 5000 ? 'is-urgent' : ''}`}
      viewBox="0 0 56 56"
      aria-label={`${Math.ceil(remaining / 1000)}s`}
    >
      <circle cx="28" cy="28" r={r} className="turn-timer__track" />
      <circle
        cx="28"
        cy="28"
        r={r}
        className="turn-timer__fill"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
      />
    </svg>
  );
}
