import { rakhtkan } from '../services/gameVariant';
import { activateEquipment, equipmentState } from '../services/equipment';
import { useLocalProfile } from '../services/localProfile';
import { useCollectibleReaction } from '../ui/collectibleReaction';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cosmetics } from '@flickkick/config';
import { IconShirt, IconUser, IconPacks, IconBall, IconFormation, IconTrail } from '../ui/icons';
import { CurrencyPackArt } from '../ui/CurrencyPackArt';
import { claimLocalPack, ownsLocal, purchaseLocal, useLocalInventory } from '../services/localInventory';
import { Badge, Button, Card, Dialog, PriceTag, ScreenHeader, Tabs } from '../ui/components';
import { TeamAttributes } from '../ui/TeamAttributes';
import { ItemPreview } from './Profile';
import { useSettings } from '../services/settings';
import { claimPack, getOnline, purchaseItem, useOnline } from '../services/online';
import { toast } from '../ui/toast';
type Tab = 'teams' | 'balls' | 'avatars' | 'formations' | 'trails' | 'currency';
export function ShopScreen() {
  const { t } = useTranslation();
  const reaction = useCollectibleReaction();
  const inventory = useLocalInventory();
  useLocalProfile();
  const [activating, setActivating] = useState<string | null>(null);
  const activate = async (kind: Exclude<Tab, 'currency'>, id: string) => {
    if (activating) return;
    setActivating(id);
    try {
      await activateEquipment(kind, id);
      reaction.play(id);
    } catch {
      toast(t('friends.failed'), 'error');
    } finally {
      setActivating(null);
    }
  };
  useOnline();
  const [buying, setBuying] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<{ kind: Tab; id: string } | null>(null);
  const purchaseLock = useRef(false);
  const selected = purchase
    ? (purchase.kind === 'currency' ? cosmetics.currencyPacks : cosmetics[purchase.kind]).find(
        (item) => item.id === purchase.id,
      )
    : undefined;
  const closePurchase = () => {
    if (!purchaseLock.current) setPurchase(null);
  };
  const confirmPurchase = async () => {
    if (!purchase || !selected || purchaseLock.current) return;
    purchaseLock.current = true;
    setBuying(purchase.id);
    try {
      let success = true;
      const online = getOnline().status === 'online';
      if (purchase.kind === 'currency') {
        if (online) await claimPack(purchase.id);
        else success = claimLocalPack(purchase.id);
      } else if (online) await purchaseItem(purchase.kind, purchase.id);
      else success = purchaseLocal(purchase.kind, purchase.id);
      toast(t(success ? 'shop.purchased' : 'shop.notEnough'), success ? 'success' : 'error');
      if (success) {
        reaction.play(purchase.id, 'purchase');
        setPurchase(null);
      }
    } catch {
      toast(t('shop.notEnough'), 'error');
    } finally {
      purchaseLock.current = false;
      setBuying(null);
    }
  };
  const settings = useSettings();
  const listRef = useRef<HTMLDivElement>(null);
  const transitionVersion = useRef(0);
  useEffect(
    () => () => {
      transitionVersion.current++;
    },
    [],
  );
  const changeCategory = async (apply: () => void) => {
    const version = ++transitionVersion.current;
    const element = listRef.current;
    if (element && !settings.reducedMotion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const exit = element.animate(
        [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(5px)' },
        ],
        { duration: 100, fill: 'forwards' },
      );
      await exit.finished.catch(() => undefined);
    }
    if (version === transitionVersion.current) apply();
  };
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(!rakhtkan && params.get('tab') === 'currency' ? 'currency' : 'teams');
  const [group, setGroup] = useState(
    params.get('group') === 'gems' ? 'gems' : params.get('tab') === 'currency' ? 'coins' : 'original',
  );
  useEffect(() => {
    if (rakhtkan || params.get('tab') !== 'currency') return;
    setTab('currency');
    setGroup(params.get('group') === 'gems' ? 'gems' : 'coins');
  }, [params]);
  const groups = tab === 'currency' ? ['coins', 'gems'] : [];
  const label = (id: string) => t(id === 'coins' || id === 'gems' ? `common.${id}` : `shop.groups.${id}`);
  const items =
    tab === 'currency'
      ? []
      : tab === 'avatars'
        ? Array.from({ length: 30 }, (_, i) => [
            cosmetics.avatars.filter((a) => !a.id.startsWith('avatar_animal_') && !a.id.startsWith('avatar_human_'))[i],
            cosmetics.avatars.filter((a) => a.id.startsWith('avatar_animal_'))[i],
            cosmetics.avatars.filter((a) => a.id.startsWith('avatar_human_'))[i],
          ])
            .flat()
            .filter((item): item is (typeof cosmetics.avatars)[number] => !!item)
        : cosmetics[tab];
  return (
    <div
      className={`screen shop-screen ${rakhtkan ? 'rakhtkan-shop' : ''} ${tab === 'currency' ? 'shop-screen--packs' : ''}`}
    >
      <div className="shop-heading">
        <ScreenHeader title={t('shop.title')} />
        <Tabs
          value={tab}
          onChange={(value) => {
            if (value === tab) {
              listRef.current?.scrollTo({ top: 0 });
              return;
            }
            void changeCategory(() => {
              setTab(value);
              setGroup(value === 'currency' ? 'coins' : 'original');
            });
          }}
          tabs={(['teams', 'balls', 'avatars', 'formations', 'trails', 'currency'] as const)
            .filter((id) => !rakhtkan || id !== 'currency')
            .map((id) => ({
              id,
              label: t(`shop.tabs.${id}`),
              icon: {
                teams: <IconShirt />,
                balls: <IconBall />,
                avatars: <IconUser />,
                formations: <IconFormation />,
                trails: <IconTrail />,
                currency: <IconPacks />,
              }[id],
            }))}
        />
      </div>
      <div className="shop-tools">
        {groups.length > 0 && (
          <Tabs
            value={group}
            onChange={(value) => {
              if (value === group) {
                listRef.current?.scrollTo({ top: 0 });
                return;
              }
              void changeCategory(() => {
                setGroup(value);
              });
            }}
            tabs={groups.map((id) => ({ id, label: label(id) }))}
          />
        )}
      </div>
      <div
        key={`${tab}-${group}`}
        ref={listRef}
        className="shop-products"
        onScroll={(event) => {
          event.currentTarget.dataset.scrolled = String(event.currentTarget.scrollTop > 1);
        }}
      >
        {tab === 'currency'
          ? cosmetics.currencyPacks
              .filter((pack) => (group === 'gems' ? !!pack.grant.gems : !!pack.grant.coins))
              .map((pack) => (
                <Card
                  className={`shop-product shop-product--pack ${inventory.packs.includes(pack.id) ? 'is-owned' : ''}`}
                  key={pack.id}
                >
                  {reaction.render(pack.id)}
                  <CurrencyPackArt id={pack.id} />
                  <strong>{t(`packs.${pack.id}`)}</strong>
                  <PriceTag price={pack.grant} />
                  <Button
                    size="sm"
                    disabled={!!pack.oneTime && inventory.packs.includes(pack.id)}
                    onClick={() => setPurchase({ kind: 'currency', id: pack.id })}
                  >
                    {t('shop.getPack')}
                  </Button>
                </Card>
              ))
          : items.map((item) => (
              <Card
                className={`shop-product ${tab === 'teams' ? 'shop-product--team' : ''} ${ownsLocal(tab, item.id) ? 'is-owned' : ''} ${rakhtkan && equipmentState(tab, item.id) === 'active' ? 'is-equipped' : ''}`}
                data-item-state={equipmentState(tab, item.id)}
                key={item.id}
              >
                {reaction.render(item.id)}
                <ItemPreview kind={tab} id={item.id} />
                <strong>{t(`${tab}.${item.id}`)}</strong>
                {tab === 'teams' && <TeamAttributes id={item.id} />}
                <PriceTag price={item.price} />
                <ShopActions>
                  {rakhtkan && equipmentState(tab, item.id) === 'active' ? (
                    <Badge tone="success">{t('locker.equipped')}</Badge>
                  ) : ownsLocal(tab, item.id) ? (
                    <>
                      <Badge tone="success">{t('shop.owned')}</Badge>
                      {rakhtkan && (
                        <Button size="sm" disabled={activating !== null} onClick={() => void activate(tab, item.id)}>
                          {t('locker.equip')}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      {rakhtkan && <Badge>{t('shop.locked')}</Badge>}
                      <Button
                        size="sm"
                        disabled={buying !== null}
                        onClick={() => setPurchase({ kind: tab, id: item.id })}
                      >
                        {t('shop.buy')}
                      </Button>
                    </>
                  )}
                </ShopActions>
              </Card>
            ))}
      </div>
      {tab !== 'currency' && items.length === 0 && <p role="status">{t('shop.noResults')}</p>}
      <Dialog
        open={!!purchase && !!selected}
        title={t(purchase?.kind === 'currency' ? 'shop.confirmPack' : 'shop.confirmPurchase')}
        onClose={closePurchase}
        dismissible={buying === null}
        actions={
          <>
            <Button variant="ghost" disabled={buying !== null} onClick={closePurchase}>
              {t('common.cancel')}
            </Button>
            <Button disabled={buying !== null} onClick={() => void confirmPurchase()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        {purchase && selected && (
          <div className="purchase-preview">
            {purchase.kind === 'currency' && 'grant' in selected ? (
              <CurrencyPackArt id={purchase.id} />
            ) : purchase.kind !== 'currency' ? (
              <ItemPreview kind={purchase.kind} id={purchase.id} />
            ) : null}
            <h3>{t(`${purchase.kind === 'currency' ? 'packs' : purchase.kind}.${purchase.id}`)}</h3>
            {purchase.kind === 'teams' && <TeamAttributes id={purchase.id} />}
            <PriceTag price={'grant' in selected ? selected.grant : selected.price} />
          </div>
        )}
      </Dialog>
    </div>
  );
}

function ShopActions({ children }: { children: ReactNode }) {
  return rakhtkan ? <div className="shop-product__actions">{children}</div> : <>{children}</>;
}
