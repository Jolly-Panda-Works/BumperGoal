import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { arenaName } from '../i18n/arenaName';
import { useNavigate } from 'react-router';
import { arenaPrize, arenasConfig, rulesConfig } from '@flickkick/config';
import { formatNumber } from '../i18n';
import { useLocalProfile } from '../services/localProfile';
import { localOnlineEnabled } from '../services/localRanked';
import { useLocalInventory } from '../services/localInventory';
import { useOnline } from '../services/online';
import { arenaCoverUrl } from '../game/art';
import { ArtImage, Button, Card, PriceTag, RANKS, RankBadge, ScreenHeader } from '../ui/components';
import { IconInfo, IconLock } from '../ui/icons';
export function OnlineScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const level = useLocalProfile().knownLevel;
  const { status, profile } = useOnline();
  const inventory = useLocalInventory();
  const online = status === 'online' || localOnlineEnabled;
  const coins = status === 'online' ? (profile?.wallet.coins ?? 0) : inventory.coins;
  const lastUnlocked = arenasConfig.arenas.reduce((last, arena, index) => (arena.minLevel <= level ? index : last), 0);
  const [selected, setSelected] = useState(lastUnlocked);
  const list = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  const finishDrag = useCallback(() => {
    const container = list.current;
    const state = drag.current;
    drag.current = null;
    if (!container || !state) return;
    container.style.scrollBehavior = '';
    if (state.moved) {
      const index = Math.max(
        0,
        Math.min(arenasConfig.arenas.length - 1, Math.round(container.scrollLeft / (container.clientWidth + 12))),
      );
      const card = container.children[index] as HTMLElement;
      container.scrollTo({
        left: card.offsetLeft,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        if (drag.current || !list.current) return;
        container.scrollTo({ left: card.offsetLeft, behavior: 'instant' });
        container.style.scrollSnapType = '';
      }, 450);
    } else container.style.scrollSnapType = '';
  }, []);
  useEffect(() => {
    window.addEventListener('pointerup', finishDrag, true);
    window.addEventListener('mouseup', finishDrag, true);
    window.addEventListener('blur', finishDrag);
    window.addEventListener('pointercancel', finishDrag, true);
    return () => {
      window.removeEventListener('pointerup', finishDrag, true);
      window.removeEventListener('mouseup', finishDrag, true);
      window.removeEventListener('blur', finishDrag);
      clearTimeout(settleTimer.current);
      window.removeEventListener('pointercancel', finishDrag, true);
    };
  }, [finishDrag]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const e = list.current?.children[lastUnlocked] as HTMLElement | undefined;
      e?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [lastUnlocked]);
  const select = (index: number) => {
    const clamped = Math.max(0, Math.min(arenasConfig.arenas.length - 1, index));
    const e = list.current?.children[clamped] as HTMLElement | undefined;
    e?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };
  return (
    <div className="screen arena-screen">
      <div className="arena-heading">
        <ScreenHeader title={t('online.title')} onBack={() => navigate('/home')} />
        {!online && (
          <button
            className="icon-btn server-tooltip"
            aria-label={t('common.requiresServerTitle')}
            title={t('common.requiresServer')}
          >
            <IconInfo />
            <span role="tooltip">{t('common.requiresServer')}</span>
          </button>
        )}
      </div>
      <div
        className="arena-carousel"
        ref={list}
        dir="ltr"
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as HTMLElement).closest('button'))
            return;
          clearTimeout(settleTimer.current);
          drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
          event.currentTarget.style.scrollBehavior = 'auto';
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state) return;
          const delta = event.clientX - state.x;
          if (Math.abs(delta) > 5) state.moved = true;
          if (state.moved) {
            event.currentTarget.style.scrollSnapType = 'none';
            event.currentTarget.scrollLeft = state.scroll - delta;
          }
        }}
        onPointerUp={finishDrag}
        onMouseUp={finishDrag}
        onLostPointerCapture={finishDrag}
        onScrollEnd={(event) => {
          if (!drag.current) event.currentTarget.style.scrollSnapType = '';
        }}
        onPointerCancel={(event) => {
          drag.current = null;
          event.currentTarget.style.scrollSnapType = '';
        }}
        onScroll={() => {
          if (!list.current) return;
          const e = list.current;
          const index = Math.round(e.scrollLeft / (e.clientWidth + 12));
          setSelected(Math.max(0, Math.min(arenasConfig.arenas.length - 1, index)));
        }}
      >
        {arenasConfig.arenas.map((arena, i) => (
          <Card key={arena.id} className={`arena ${level < arena.minLevel ? 'is-locked' : ''}`} dir={i18n.dir()}>
            <ArtImage className="arena__art" src={arenaCoverUrl(arena)} />
            <div className="arena__title">
              <h3>{arenaName(arena.id, t, i18n.language)}</h3>
              <RankBadge rank={RANKS[Math.min(i, RANKS.length - 1)]!} size={48} label={false} />
            </div>
            <dl>
              <div>
                <dt>{t('online.entryFee')}</dt>
                <dd>
                  <PriceTag price={{ coins: arena.entryFee }} />
                </dd>
              </div>
              <div>
                <dt>{t('online.prize')}</dt>
                <dd>
                  <PriceTag price={{ coins: arenaPrize(arena) }} />
                </dd>
              </div>
            </dl>
            <p>{t('online.goalsToWin', { n: formatNumber(rulesConfig.goalsToWin) })}</p>
            {level < arena.minLevel ? (
              <Button disabled title={t('online.locked', { level: formatNumber(arena.minLevel) })}>
                <IconLock size={18} /> {t('online.unlock')}
              </Button>
            ) : (
              <Button
                disabled={!online || coins < arena.entryFee}
                onClick={() => navigate(`/play/online/search?arena=${arena.id}`)}
              >
                {online && coins < arena.entryFee ? t('online.notEnoughCoins') : t('online.play')}
              </Button>
            )}
          </Card>
        ))}
      </div>
      <div className="arena-dots" aria-label={t('online.title')}>
        {arenasConfig.arenas.map((arena, i) => (
          <button
            type="button"
            key={arena.id}
            aria-label={arenaName(arena.id, t, i18n.language)}
            aria-current={selected === i ? 'true' : undefined}
            onClick={() => select(i)}
          >
            <span />
          </button>
        ))}
      </div>
    </div>
  );
}
