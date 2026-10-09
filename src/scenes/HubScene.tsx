import { useRef, useState, type CSSProperties } from 'react';
import { HubWordmark } from '../ui/HubWordmark';
import { ArtButtonSurface } from '../ui/ArtButtonSurface';
import { assetManifest, cardArtUrl, cardFaceUrl } from '../data/assets';
import { HubSideRail } from '../ui/HubSideRail';
import { MenuChrome } from '../ui/MenuChrome';
import { PlayerStatus } from '../ui/PlayerStatus';
import { PosterCarousel } from '../ui/PosterCarousel';
import { HubLogoLayer, type HubLogoItem } from '../ui/HubLogoLayer';
import { pushToast } from '../state/toastStore';
import { useSettingsStore } from '../state/settingsStore';
import { menuPosters, POSTER_ROUTES } from './menuPosters';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';
import '../ui/hubMenu.css';

export interface HubSceneProps {
  readonly profile: ProfileState;
  readonly onNavigate: (route: RouteId) => void;
  readonly onReset: () => void;
}

type Palette = 'default' | 'blue' | 'teal' | 'ember' | 'violet' | 'gacha';
interface HubEntry extends HubLogoItem {
  readonly route: RouteId | null;
  readonly label: string;
  readonly hint: string;
  readonly palette?: Palette;
  readonly reset?: boolean;
}

const MAIN_ROWS: readonly (readonly HubEntry[])[] = [
  [
    { id: 'start', kind: 'battle', color: '#b5c9d1', route: 'battlemenu', label: '开始战斗', hint: '选择对战模式', palette: 'blue' },
    { id: 'daily', kind: 'market', color: '#b5c4ac', route: 'shop', label: '今日商城', hint: '今日货架', palette: 'teal' },
  ],
  [
    { id: 'events', kind: 'activity', color: '#d2b091', route: 'activity', label: '活动模式', hint: '限时活动', palette: 'ember' },
    { id: 'event-shop', kind: 'market', color: '#c8bbcf', route: 'activityShop', label: '活动商店', hint: '活动卡牌与徽章', palette: 'violet' },
  ],
  [
    { id: 'ranking', kind: 'ranking', color: '#dec184', route: null, label: '排行榜', hint: '排行榜暂未开放' },
    { id: 'statistics', kind: 'statistics', color: '#a8c1c4', route: null, label: '统计数据', hint: '统计数据暂未开放' },
    { id: 'demo', kind: 'demo', color: '#b6b3e6', route: 'battle', label: '战斗演示', hint: '不影响存档的演示对局' },
  ],
];
const DOCK: readonly HubEntry[] = [
  { id: 'mall', kind: 'market', color: '#d7b774', route: null, label: '商城', hint: '商城暂未开放' },
  { id: 'gacha', kind: 'gacha', color: '#edb16d', route: 'gacha', label: '抽卡', hint: '选择卡池，单抽或十连', palette: 'gacha' },
  { id: 'deck', kind: 'deck', color: '#d7b774', route: 'deck', label: '配置', hint: '配置 12 张出战卡牌' },
  { id: 'collection', kind: 'collection', color: '#d7b774', route: 'collection', label: '卡牌图鉴', hint: '浏览卡牌与特性' },
  { id: 'fusion', kind: 'fusion', color: '#d7b774', route: 'fusion', label: '融合工坊', hint: '五张材料在祭坛融合' },
  { id: 'settings', kind: 'settings', color: '#d7b774', route: 'settings', label: '设置', hint: '画质、视角、音效与存档' },
  { id: 'reset', kind: 'reset', color: '#d7b774', route: null, label: '重置存档', hint: '清空卡牌、货币与关卡进度', reset: true },
];
const LOGOS: readonly HubLogoItem[] = [...MAIN_ROWS.flat(), ...DOCK];
const MAIN_ART: Readonly<Record<string, string>> = {
  start: 'SSS_008', daily: 'A+_006', events: 'A+_002', 'event-shop': 'SS+_005',
  ranking: 'SSS_001', statistics: 'S_002', demo: 'SS_001',
  mall: 'SS_001', gacha: 'SSS_008', deck: 'A+_002', collection: 'SS+_005',
  fusion: 'A+_006', settings: 'S_002', reset: 'SSS_001',
};

const PALETTES: Record<Palette, { from: string; to: string }> = {
  default: { from: 'rgba(24, 32, 43, .92)', to: 'rgba(34, 38, 43, .86)' },
  blue: { from: 'rgba(24, 37, 48, .96)', to: 'rgba(59, 76, 84, .94)' },
  teal: { from: 'rgba(27, 43, 39, .96)', to: 'rgba(69, 82, 65, .93)' },
  ember: { from: 'rgba(60, 37, 30, .96)', to: 'rgba(103, 74, 53, .93)' },
  violet: { from: 'rgba(45, 38, 51, .96)', to: 'rgba(83, 72, 83, .93)' },
  gacha: { from: 'rgba(108, 66, 36, .96)', to: 'rgba(120, 37, 42, .94)' },
};

/** Lobby entry blocks and an equal-width dock share one transparent 3D logo layer. */
export function HubScene({ profile, onNavigate, onReset }: HubSceneProps) {
  const still = useSettingsStore((state) => state.reduceMotion);
  const [activeId, setActiveId] = useState<string | null>(null);
  const anchors = useRef(new Map<string, HTMLSpanElement>());
  const background = assetManifest.shared.menu['menu_bg']?.url ?? null;

  const activate = (entry: HubEntry): void => {
    if (entry.reset) {
      if (window.confirm('重置存档？当前的卡牌、货币与关卡进度都会被清掉。')) onReset();
    } else if (entry.route) {
      onNavigate(entry.route);
    } else {
      pushToast(entry.hint, 'info');
    }
  };
  const clearActive = (id: string): void => setActiveId((previous) => previous === id ? null : previous);
  const button = (entry: HubEntry, dock: boolean) => {
    const palette = PALETTES[entry.palette ?? 'default'];
    const artId = MAIN_ART[entry.id];
    const art = artId ? cardArtUrl(artId) ?? cardFaceUrl(artId, 'battle') : null;
    return <div key={entry.id} className="hub-button-shell"
      onPointerEnter={() => setActiveId(entry.id)}
      onPointerLeave={(event) => { if (!event.currentTarget.querySelector('button:focus-visible')) clearActive(entry.id); }}>
      <button type="button"
      className={`hub-button art-button${entry.id === 'gacha' ? ' art-button--gold' : ''} ${dock ? 'hub-dock__item' : 'hub-main__button'} hub-button--${entry.id}${activeId === entry.id ? ' hub-button--active' : ''}`}
      style={{ '--hub-color': entry.color, '--hub-from': palette.from, '--hub-to': palette.to, '--button-art': art ? `url("${art}")` : 'none' } as CSSProperties}
      title={entry.hint} data-unavailable={entry.route === null && !entry.reset}
      onFocus={() => setActiveId(entry.id)} onBlur={() => clearActive(entry.id)}
      onClick={() => activate(entry)}>
      <ArtButtonSurface />
      <span className="hub-logo-anchor" aria-hidden="true" ref={(node) => {
        if (node) anchors.current.set(entry.id, node); else anchors.current.delete(entry.id);
      }} />
      <span className="hub-button__copy"><strong>{entry.label}</strong>
        {!dock && entry.route && <small>{entry.hint}</small>}
      </span>
    </button></div>;
  };

  return <MenuChrome className={`menu--hub hub-menu${still ? ' hub-menu--still' : ''}`}
    backgroundUrl={background} title={<HubWordmark />}
    status={<PlayerStatus level={profile.level} currencies={profile.currencies} />}>
    <HubSideRail />
    <nav className="hub-main" aria-label="主界面玩法">
      {MAIN_ROWS.map((row, index) => <div key={index} className={`hub-main__row hub-main__row--${index + 1}`}>
        {row.map((entry) => button(entry, false))}
      </div>)}
    </nav>
    <PosterCarousel posters={menuPosters()} still={still}
      onSelect={(index) => onNavigate(POSTER_ROUTES[index] ?? 'campaign')} />
    <nav className="hub-dock" aria-label="底部导航">
      {DOCK.map((entry) => button(entry, true))}
    </nav>
    <HubLogoLayer items={LOGOS} anchors={anchors} activeId={activeId} still={still} />
  </MenuChrome>;
}
