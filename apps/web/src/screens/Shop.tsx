import { useCatalogMotion } from '../ui/useCatalogMotion';
import { CatalogPager } from '../ui/CatalogPager';
import { rakhtkan } from '../services/gameVariant';
import { activateEquipment, equipmentState } from '../services/equipment';
import { useLocalProfile } from '../services/localProfile';
import { useCollectibleReaction } from '../ui/collectibleReaction';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cosmetics } from '@flickkick/config';
import { IconCar, IconPacks, IconBall, IconFormation, IconTrail } from '../ui/icons';
import { CurrencyPackArt } from '../ui/CurrencyPackArt';
import { claimLocalPack, ownsLocal, purchaseLocal, useLocalInventory } from '../services/localInventory';
import { Avatar, Badge, Button, Card, Dialog, PriceTag, ScreenHeader, Tabs } from '../ui/components';
import { TeamAttributes } from '../ui/TeamAttributes';
import { ItemPreview } from './Profile';
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
  const motion = useCatalogMotion();
  const listRef = motion.listRef;
  const changeCategory = motion.switchCategory;
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
  const [catalogPage, setCatalogPage] = useState({ key: '', index: 0 });
  const pageKey = `${tab}-${group}`;
  const page = catalogPage.key === pageKey ? catalogPage.index : 0;
  const packItems = cosmetics.currencyPacks.filter((pack) =>
    group === 'gems' ? !!pack.grant.gems : !!pack.grant.coins,
  );
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
  const pages = Math.max(1, (tab === 'currency' ? packItems.length : items.length) - motion.visibleCount + 1);
  const currentPage = Math.min(page, pages - 1);
  const visibleItems = rakhtkan ? items : items.slice(currentPage, currentPage + motion.visibleCount);
  return (
    <div
      className={`screen shop-screen ${!rakhtkan ? 'catalog-art' : ''} ${rakhtkan ? 'rakhtkan-shop' : ''} ${tab === 'currency' ? 'shop-screen--packs' : ''}`}
    >
      <div className="shop-heading">
        <div className="section-heading">
          <ScreenHeader title={t('shop.title')} />
          <Link className="btn btn--ghost" to="/locker">
            {t('nav.inventory')}
          </Link>
        </div>
        <p className="section-note">{t('shop.purchaseOnly')}</p>
        <Tabs
          animate={rakhtkan}
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
                teams: <IconCar />,
                balls: <IconBall />,
                avatars: <Avatar id="avatar_fox" size={48} />,
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
            animate={rakhtkan}
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
      <div className="catalog-viewport">
        <div
          ref={listRef}
          className="shop-products"
          onScroll={(event) => {
            event.currentTarget.dataset.scrolled = String(event.currentTarget.scrollTop > 1);
          }}
        >
          {tab === 'currency'
            ? packItems.slice(currentPage, currentPage + motion.visibleCount).map((pack) => (
                <Card
                  className={`shop-product shop-product--pack ${inventory.packs.includes(pack.id) ? 'is-owned' : ''}`}
                  key={pack.id}
                  data-catalog-id={pack.id}
                >
                  {reaction.render(pack.id)}
                  <CurrencyPackArt id={pack.id} />
                  <strong>{t(`packs.${pack.id}`)}</strong>
                  <Button
                    className="shop-buy-button"
                    size="sm"
                    disabled={!!pack.oneTime && inventory.packs.includes(pack.id)}
                    onClick={() => setPurchase({ kind: 'currency', id: pack.id })}
                  >
                    <PriceTag price={pack.grant} />
                    <span>{t('shop.getPack')}</span>
                  </Button>
                </Card>
              ))
            : visibleItems.map((item) => (
                <Card
                  className={`shop-product ${tab === 'teams' ? 'shop-product--team' : ''} ${ownsLocal(tab, item.id) ? 'is-owned' : ''} ${rakhtkan && equipmentState(tab, item.id) === 'active' ? 'is-equipped' : ''}`}
                  data-item-state={equipmentState(tab, item.id)}
                  key={item.id}
                  data-catalog-id={item.id}
                >
                  {reaction.render(item.id)}
                  <ItemPreview kind={tab} id={item.id} />
                  <strong>{t(`${tab}.${item.id}`)}</strong>
                  {tab === 'teams' && <TeamAttributes id={item.id} />}
                  {(rakhtkan || ownsLocal(tab, item.id)) && <PriceTag price={item.price} />}
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
                          className={!rakhtkan ? 'shop-buy-button' : ''}
                          disabled={buying !== null}
                          onClick={() => setPurchase({ kind: tab, id: item.id })}
                        >
                          {!rakhtkan && <PriceTag price={item.price} />}
                          <span>{t('shop.buy')}</span>
                        </Button>
                      </>
                    )}
                  </ShopActions>
                </Card>
              ))}
        </div>
      </div>
      {tab !== 'currency' && items.length === 0 && <p role="status">{t('shop.noResults')}</p>}
      {!rakhtkan && (
        <CatalogPager
          offset={currentPage}
          total={tab === 'currency' ? packItems.length : items.length}
          visibleCount={motion.visibleCount}
          onChange={(index) =>
            void motion.moveWindow(() => setCatalogPage({ key: pageKey, index }), index - currentPage)
          }
        />
      )}
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
