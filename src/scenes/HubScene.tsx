import { assetManifest } from '../data/assets';
import { ComingSoonBadge } from '../ui/ComingSoonBadge';
import { CurrencyBar } from '../ui/CurrencyBar';
import { LevelBar } from '../ui/LevelBar';
import { useParallax } from '../ui/useParallax';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';

/**
 * 主菜单。
 *
 * 版式照旧版 `scenes/menu.py`：
 *
 * - **视差背景**（`ui/background.py`）：鼠标偏离中心多少，背景就往反方向偏多少；
 * - **标题**居中偏上（12% 高度），金色 + 硬阴影；
 * - **两列阶梯按钮**：一级 6 个、二级 5 个，每往下一行整体左移 30px；
 *   按钮本身**没有底板**——是一个标签加左右两个三角形，
 *   悬停时标签后面亮起该入口的代表色并脉动（`ui/menu_button.py` 的 glow）；
 * - 货币与等级在左上，版本号在右下，提示条在底部居中。
 *
 * **照搬不了的地方，以及为什么**：
 *
 * 1. 旧版的最后两颗一级按钮是「设置 / 退出游戏」。网页里没有「退出」，
 *    那颗位置留给项目本来就有的「重置存档」（同为危险操作，同样放最后一格）。
 * 2. 旧版二级是「活动入口 / 商店 / 工坊 / 公告 / 教学关卡」。本项目实际有的是
 *    「演示战斗 / 商店 / 融合 / 自选对战 / 迷宫」——商店已经从二级升到一级
 *    （它在本项目里是真实入口），二级补上演示战斗（P3 的固定 seed 对局，
 *    唯一能直接看一局演出的入口）与 P6 的四项。
 * 3. 旧版的二级列 x 坐标算下来会**有一部分跑到屏幕外**（`base_x + button_width +
 *    2*stagger`，按 1920 宽算右边缘到 2004）。这里改成整块两列右对齐、
 *    每行向左阶梯展开，宽度不够时收窄，不复制那个越界。
 */

export interface HubSceneProps {
  readonly profile: ProfileState;
  readonly onNavigate: (route: RouteId) => void;
  /** 重置存档。开发期很需要——比如新号规则变了之后，旧存档不会自己变。 */
  readonly onReset: () => void;
}

interface Entry {
  /** 有目标路由的才是「能进去的」，其余是占位入口。 */
  readonly route?: RouteId;
  readonly label: string;
  readonly hint: string;
  /** 悬停时亮起的光色，取自旧版 `menu.py` 的按钮配色。 */
  readonly glow: string;
}

const PRIMARY: readonly Entry[] = [
  { route: 'campaign', label: '进入战斗', hint: '三章十二关，打赢拿金币与经验', glow: '#ff5050' },
  { route: 'gacha', label: '抽卡', hint: '八个卡池，概率由配置算出', glow: '#ffa032' },
  { route: 'deck', label: '配置', hint: '最多 12 张，重复卡受拥有量限制', glow: '#6ea8ff' },
  { route: 'collection', label: '卡牌图鉴', hint: '按稀有度筛选，看清每一张的详情', glow: '#64e0a0' },
  { route: 'shop', label: '商店', hint: '每日货架，卖完即止', glow: '#45c8c8' },
  { route: 'battle', label: '演示战斗', hint: '固定种子的对局，不影响存档', glow: '#9a6bff' },
];

const SECONDARY: readonly Entry[] = [
  { route: 'settings', label: '设置', hint: '画质、台面、视角与演出速度', glow: '#c8a2ff' },
  { label: '融合', hint: '五槽融合，消耗卡牌换取更高稀有度', glow: '#ff78a0' },
  { label: '自选对战', hint: '本地双人自选牌组', glow: '#78ffd2' },
  { label: 'Draft', hint: '28 张候选轮流选牌', glow: '#78c8ff' },
  { label: '迷宫', hint: '第一层迷宫探索与节点战斗', glow: '#ffdc78' },
];

/** 主菜单背景。manifest 里唯一的「资产 ID → URL」入口，不自己拼路径。 */
function menuBackgroundUrl(): string | null {
  return assetManifest.shared.menu['menu_bg']?.url ?? null;
}

export function HubScene({ profile, onNavigate, onReset }: HubSceneProps) {
  const parallaxRef = useParallax();
  const background = menuBackgroundUrl();
  const activeDeck = profile.decks.find((deck) => deck.id === profile.activeDeckId) ?? null;

  const entryButton = (entry: Entry, row: number, small: boolean) => {
    const coming = entry.route === undefined;
    const label = entry.label;
    return (
      <button
        key={label}
        type="button"
        className={small ? 'menu__entry menu__entry--small' : 'menu__entry'}
        style={{ ['--row' as string]: row, ['--glow' as string]: entry.glow }}
        disabled={coming}
        title={coming ? `${entry.hint}（计划在 P6 阶段实现）` : entry.hint}
        onClick={() => {
          if (entry.route) {
            onNavigate(entry.route);
          }
        }}
      >
        {/* 悬停时亮起的那团光。单独一层，才好只让它做脉动 */}
        <span className="menu__entry-glow" aria-hidden="true" />
        <span className="menu__entry-tri" aria-hidden="true" />
        <span className="menu__entry-label">
          {label}
          {coming && <ComingSoonBadge />}
        </span>
        <span className="menu__entry-tri menu__entry-tri--right" aria-hidden="true" />
      </button>
    );
  };

  return (
    <div className="menu" ref={parallaxRef}>
      {/*
        背景单独一层并放大到 110%：视差是靠**平移这一层**做的，
        不放大就会在边缘露出底色（旧版也是 1.1 倍）。
        没有背景图时退回纯色，不假装有。
      */}
      <div
        className="menu__bg"
        style={background ? { backgroundImage: `url(${background})` } : undefined}
        aria-hidden="true"
      />
      <div className="menu__scrim" aria-hidden="true" />

      <div className="menu__status">
        <LevelBar level={profile.level} />
        <CurrencyBar currencies={profile.currencies} />
      </div>

      <h1 className="menu__title">Card Master 3D</h1>
      <p className="menu__deck">
        当前出战：{activeDeck ? `${activeDeck.name}（${activeDeck.cardIds.length} 张）` : '未选择卡组'}
      </p>

      <nav className="menu__columns" aria-label="主菜单">
        <div className="menu__column">
          {PRIMARY.map((entry, index) => entryButton(entry, index, false))}
        </div>
        <div className="menu__column menu__column--side">
          {SECONDARY.map((entry, index) => entryButton(entry, index, true))}
        </div>
      </nav>

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
  );
}
