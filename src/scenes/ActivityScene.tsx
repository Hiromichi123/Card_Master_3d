import { backgroundUrl } from '../data/assets';
import { MenuChrome, MenuEntryButton } from '../ui/MenuChrome';
import { CurrencyBar } from '../ui/CurrencyBar';
import { LevelBar } from '../ui/LevelBar';
import { pushToast } from '../state/toastStore';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';

/**
 * 限时活动模式（活动大厅）。1:1 照旧版 `scenes/activity/activity_scene.py`：
 *
 * - 背景 `bg/activity`；
 * - 标题「限时活动模式」（86 设计单位、米白）+ 一行副标题，12% / 18% 高；
 * - **左侧三张特性卡**：宽 45%、高 10%、起点 (15%, 28%)、间隔 4%，
 *   深蓝半透明面板 + 蓝边，悬停时底色加深、边框转金；
 * - **右侧一列按钮**：x = 80%、y = 30%、320×58、行距 90、**阶梯 20**（比主菜单小）；
 * - 左上角货币与等级。
 *
 * 三张特性卡与三种去向都照旧版：
 * 迷宫挑战（点进迷宫）/ 深渊挑战（未开放）/ 协力突袭（未开放）；
 * 按钮是「前往单人战役 / 活动商店 / 返回主菜单」。
 *
 * **不能照搬的一处**：旧版第一张卡直接进 `activity_maze_scene`，
 * 那是 P6 的范围，本项目还没有——所以三张卡都按旧版对「未开放」那张的处理，
 * 点了给一句提示。等迷宫做完，把第一张接上 `maze` 路由即可。
 */
export interface ActivitySceneProps {
  readonly profile: ProfileState;
  readonly onNavigate: (route: RouteId) => void;
}

interface Feature {
  readonly title: string;
  readonly desc: string;
  readonly schedule: string;
  /** 有路由的才进得去；其余给了提示（旧版 index 0 进迷宫）。 */
  readonly route: RouteId | null;
}

const FEATURES: readonly Feature[] = [
  {
    title: '迷宫挑战',
    desc: '进入限时迷宫，连续挑战三个阶段首领，获得最终奖励。',
    schedule: '活动期间常驻开放',
    route: null,
  },
  {
    title: '深渊挑战（未开放）',
    desc: '携带自定义卡组车轮战挑战多层深渊，获取稀有奖励。',
    schedule: '每周开放 3 个全新层级',
    route: null,
  },
  {
    title: '协力突袭（未开放）',
    desc: '匹配其他玩家共同击破巨型敌人，分享掉落。',
    schedule: '周末限时开放',
    route: null,
  },
];

interface ActivityEntry {
  readonly label: string;
  readonly hint: string;
  readonly glow: string;
  readonly route: RouteId | null;
}

const ENTRIES: readonly ActivityEntry[] = [
  {
    label: '前往单人战役',
    hint: '三章十二关，打赢拿金币与经验',
    glow: '#ffb478',
    route: 'campaign',
  },
  {
    label: '活动商店',
    hint: '用徽章兑换活动卡牌',
    glow: '#b48cff',
    route: 'activityShop',
  },
  { label: '返回主菜单', hint: '回到主菜单', glow: '#78c8ff', route: 'hub' },
];

export function ActivityScene({ profile, onNavigate }: ActivitySceneProps) {
  /*
    背景走 `backgroundUrl`（旧版写的是 `ParallaxBackground(..., "bg/activity")`）。
    注意它和另外两个菜单不在同一张表里：`menu_bg` / `battle_menu_bg` 在
    manifest 的 `shared.menu` 下，活动背景在 `shared.bg` 下——
    按 `shared.menu` 找会拿到 null，界面上表现为「背景没加载出来」。
  */
  const background = backgroundUrl('bg/activity');

  return (
    <MenuChrome
      backgroundUrl={background}
      title="限时活动模式"
      titleSize={86}
      subtitle="限时玩法与合作挑战在此汇集，完成目标可兑换限定卡牌奖励。"
      status={
        <>
          <LevelBar level={profile.level} />
          <CurrencyBar currencies={profile.currencies} />
        </>
      }
    >
      <div className="feature-list" aria-label="活动玩法">
        {FEATURES.map((feature, index) => (
          <button
            key={feature.title}
            type="button"
            className="feature"
            /* 起点 28%，每张卡高 10% + 间隔 4% —— 旧版就是这么算的 */
            style={{ top: `calc(28% + ${index} * 14%)` }}
            onClick={() => {
              if (feature.route) {
                onNavigate(feature.route);
                return;
              }
              pushToast(`${feature.title} 将随版本更新开放`, 'info');
            }}
          >
            <span className="feature__title">{feature.title}</span>
            <span className="feature__desc">{feature.desc}</span>
            <span className="feature__schedule">{feature.schedule}</span>
          </button>
        ))}
      </div>

      <nav
        className="menu__columns"
        aria-label="活动入口"
        style={{
          ['--cols-x' as string]: '80%',
          ['--cols-y' as string]: '30%',
          ['--entry-w' as string]: 320,
          ['--entry-h' as string]: 58,
          ['--row-stagger' as string]: -20,
          ['--row-gap' as string]: 32,
        }}
      >
        <div className="menu__column">
          {ENTRIES.map((entry, row) => (
            <MenuEntryButton
              key={entry.label}
              label={entry.label}
              hint={entry.hint}
              glow={entry.glow}
              row={row}
              onClick={() => onNavigate(entry.route ?? 'hub')}
            />
          ))}
        </div>
      </nav>
    </MenuChrome>
  );
}
