import { assetManifest } from '../data/assets';
import { ComingSoonBadge } from '../ui/ComingSoonBadge';
import { CurrencyBar } from '../ui/CurrencyBar';
import { LevelBar } from '../ui/LevelBar';
import { PosterCarousel } from '../ui/PosterCarousel';
import { pushToast } from '../state/toastStore';
import { useParallax } from '../ui/useParallax';
import { useSettingsStore } from '../state/settingsStore';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';

/**
 * 主菜单。
 *
 * ## 坐标一律走「设计空间 + 整体等比缩放」
 *
 * 旧版 `config.py` 的做法是：定一个 **2880 × 1800 的设计分辨率**，
 * `AUTO_SCALE = min(屏幕宽/设计宽, 屏幕高/设计高)`，然后 `UI_SCALE = AUTO_SCALE`，
 * `WINDOW_WIDTH = 设计宽 × AUTO_SCALE`。也就是说**布局全部写在设计空间里**，
 * 最后整体乘一个因子——所有 `WINDOW_WIDTH * 0.70` 这类比例，
 * 分母都是那个缩放后的设计框，不是浏览器窗口。
 *
 * 这里照做：`.menu__stage` 就是 2880×1800 的设计框（按 `--ui` 等比缩放到视口），
 * 里面的位置用 `%`（相对设计框）、尺寸用 `calc(N * var(--ui))`。
 *
 * **上一版把这件事做错了**：我按 1920 窗口算 `WINDOW_WIDTH * 0.70`，
 * 于是算出「二级列会跑到屏幕外」，还自作主张改成右对齐。实际上在 2880 的设计空间里
 * 二级列右边缘是 2676 / 2880 = **93%**，本来就是放得下的。
 *
 * ## 版式（全部来自 `scenes/menu.py`，数值是设计单位）
 *
 * | 元素 | 位置 |
 * | --- | --- |
 * | 标题 | 居中，12% 高；金色 + 硬阴影 |
 * | 一级列 | x = 70%，y = 25% 起，行距 90、每行左移 30 |
 * | 二级列 | x = 70% + 300 + 60（= 一级列宽 + 两倍阶梯），其余同 |
 * | 海报轮播 | (58%, 60%)，尺寸 35% × 30%（`activity_poster.py` 里就是这么算的） |
 * | 货币与等级 | 左上 |
 *
 * ## 照搬不了的地方
 *
 * 1. 网页没有「退出游戏」，那格留给项目本来就有的「重置存档」。
 * 2. 旧版二级列是「活动入口 / 商店 / 工坊 / 公告 / 教学关卡」。
 *    本项目实际有的是「商店（真入口）/ 活动入口 / 融合 / Draft / 迷宫」——
 *    **活动入口照旧版的做法**：能点，点了给一句「即将开放」的提示
 *    （旧版 `_show_feature_notice` 就是这么处理未实现入口的），
 *    而不是做成灰色的禁用按钮。
 */

export interface HubSceneProps {
  readonly profile: ProfileState;
  readonly onNavigate: (route: RouteId) => void;
  /** 重置存档。开发期很需要——比如新号规则变了之后，旧存档不会自己变。 */
  readonly onReset: () => void;
}

interface Entry {
  /** 有路由的可以进去；`null` 表示「还没做，点了给提示」。 */
  readonly route: RouteId | null;
  readonly label: string;
  readonly hint: string;
  /** 悬停时亮起的光色，取自旧版 `menu.py` 的按钮配色。 */
  readonly glow: string;
  /** 标「待开发」徽标（P6 才做的那些）。 */
  readonly coming?: boolean;
}

const PRIMARY: readonly Entry[] = [
  { route: 'campaign', label: '进入战斗', hint: '三章十二关，打赢拿金币与经验', glow: '#c83232' },
  { route: 'gacha', label: '抽卡', hint: '八个卡池，概率由配置算出', glow: '#ff8c00' },
  { route: 'deck', label: '配置', hint: '最多 12 张，重复卡受拥有量限制', glow: '#6496ff' },
  { route: 'collection', label: '卡牌图鉴', hint: '按稀有度筛选，看清每一张的详情', glow: '#64c896' },
  { route: 'battle', label: '演示战斗', hint: '固定种子的对局，不影响存档', glow: '#a064ff' },
  { route: 'settings', label: '设置', hint: '画质、台面、视角与演出速度', glow: '#9664ff' },
];

const SECONDARY: readonly Entry[] = [
  { route: null, label: '活动入口', hint: '限时活动与活动商店', glow: '#ffdc78' },
  { route: 'shop', label: '商店', hint: '每日货架，卖完即止', glow: '#b478ff' },
  { route: null, label: '融合', hint: '五槽融合，消耗卡牌换取更高稀有度', glow: '#78d2ff', coming: true },
  { route: null, label: 'Draft', hint: '28 张候选轮流选牌', glow: '#ff78a0', coming: true },
  { route: null, label: '迷宫', hint: '第一层迷宫探索与节点战斗', glow: '#78ffc8', coming: true },
];

/** 主菜单背景。manifest 是唯一的「资产 ID → URL」入口，不自己拼路径。 */
function menuBackgroundUrl(): string | null {
  return assetManifest.shared.menu['menu_bg']?.url ?? null;
}

/**
 * 轮播用的海报。
 *
 * manifest 的 `poster` 里有三类：`poster001/002`（**旧版那两张活动海报**，
 * 旧版的 `assets/poster/poster*.png`，轮播本来就是给它们做的）、
 * `chapter_*_enter`（章节入场图）、以及 12 张关卡海报。
 *
 * 取前两类共 5 张：17 张全放进来要 85 秒才轮一圈，而且关卡海报是选关时看的图，
 * 放在菜单轮播里跟「活动」不是一回事。**顺序写在前面**（活动 → 章节），
 * 一个都没有时退回全部海报，不留空。
 */
function menuPosters(): readonly string[] {
  const poster = assetManifest.shared.poster;
  const pick = (keys: readonly string[]): string[] =>
    keys
      .map((key) => poster[key]?.url)
      .filter((url): url is string => typeof url === 'string' && url.length > 0);

  const preferred = pick([
    'poster001',
    'poster002',
    'chapter_1_enter',
    'chapter_2_enter',
    'chapter_3_enter',
  ]);
  if (preferred.length > 0) {
    return preferred;
  }
  return Object.keys(poster)
    .map((key) => poster[key]?.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

export function HubScene({ profile, onNavigate, onReset }: HubSceneProps) {
  const parallaxRef = useParallax();
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);
  const background = menuBackgroundUrl();
  const posters = menuPosters();
  const activeDeck = profile.decks.find((deck) => deck.id === profile.activeDeckId) ?? null;

  const entryButton = (entry: Entry, row: number) => (
    <button
      key={entry.label}
      type="button"
      className="menu__entry"
      style={{ ['--row' as string]: row, ['--glow' as string]: entry.glow }}
      title={entry.coming ? `${entry.hint}（计划在 P6 阶段实现）` : entry.hint}
      onClick={() => {
        if (entry.route) {
          onNavigate(entry.route);
          return;
        }
        // 旧版对未实现的入口是「点了给一句提示」，不是把按钮做成灰的
        pushToast(`${entry.label}即将开放`, 'info');
      }}
    >
      {/* 悬停时亮起的那三层同心光晕；常态是透明的 */}
      <span className="menu__entry-glow" aria-hidden="true" />
      <span className="menu__entry-tri" aria-hidden="true" />
      <span className="menu__entry-label">
        {entry.label}
        {entry.coming && <ComingSoonBadge />}
      </span>
      <span className="menu__entry-tri menu__entry-tri--right" aria-hidden="true" />
    </button>
  );

  return (
    <div className="menu" ref={parallaxRef}>
      {/*
        背景铺满整个视口（不放在设计框里）：视差是靠平移这一层做的，
        跟着设计框缩放的话，窗口比设计比例更宽时两侧会露边。
      */}
      <div
        className="menu__bg"
        style={background ? { backgroundImage: `url(${background})` } : undefined}
        aria-hidden="true"
      />
      <div className="menu__scrim" aria-hidden="true" />

      {/* 2880 × 1800 的设计框：里面的坐标才是旧版那套比例 */}
      <div className="menu__stage">
        <div className="menu__status">
          <LevelBar level={profile.level} />
          <CurrencyBar currencies={profile.currencies} />
        </div>

        <h1 className="menu__title">Card Master 3D</h1>
        <p className="menu__deck">
          当前出战：
          {activeDeck ? `${activeDeck.name}（${activeDeck.cardIds.length} 张）` : '未选择卡组'}
        </p>

        <nav className="menu__columns" aria-label="主菜单">
          <div className="menu__column">{PRIMARY.map((entry, i) => entryButton(entry, i))}</div>
          <div className="menu__column menu__column--side">
            {SECONDARY.map((entry, i) => entryButton(entry, i))}
          </div>
        </nav>

        <PosterCarousel
          posters={posters}
          onSelect={() => onNavigate('campaign')}
          still={reduceMotion}
        />

        <button
          type="button"
          className="menu__reset"
          title="清空存档并按当前规则重新开号"
          onClick={() => {
            if (window.confirm('重置存档？当前的卡牌、货币与关卡进度都会被清掉。')) {
              onReset();
            }
          }}
        >
          重置存档
        </button>

        <span className="menu__version">v0.1.0</span>
      </div>
    </div>
  );
}
