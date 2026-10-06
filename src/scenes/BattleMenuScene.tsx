import { assetManifest } from '../data/assets';
import { MenuChrome, MenuEntryButton } from '../ui/MenuChrome';
import { PosterCarousel } from '../ui/PosterCarousel';
import { CurrencyBar } from '../ui/CurrencyBar';
import { LevelBar } from '../ui/LevelBar';
import { pushToast } from '../state/toastStore';
import { useSettingsStore } from '../state/settingsStore';
import { menuPosters, POSTER_ROUTES } from './menuPosters';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';

/**
 * 选择对战模式。1:1 照旧版 `scenes/battle_menu.py`：
 *
 * - 背景 `battle_menu`（旧版 `ParallaxBackground(..., "battle_menu")`）；
 * - 标题「选择对战模式」金色 + 硬阴影，居中 12% 高；
 * - **单列**六项，x = **75%**（主菜单是 70%），y = 25%，行距 90、阶梯 30；
 * - 海报轮播同主菜单，位置 (58%, 60%)；
 * - 左上角货币与等级。
 *
 * 六项逐个对应（顺序、颜色、去向都照旧版）：
 *
 * | 旧版 | 本项目 |
 * | --- | --- |
 * | 单人战役 → world_map | 单人战役 → 战役 |
 * | 活动模式 → activity_scene（**常态亮着**） | 活动模式 → 活动大厅（同样常态亮着） |
 * | 局域网 卡组对战 / 局域网 任选对战 → simple_battle | **未开放**（见下） |
 * | 本地 任选对战（双人）→ draft_scene | 未开放（Draft 在 P6） |
 * | 返回主菜单 | 返回主菜单 |
 *
 * **两处不能照搬**，都在旧版里对应本项目的既定范围：
 * 1. PLAN 第 6 节明确「UI 不提供冒充联机的入口」，所以两条「局域网」保留位置、
 *    但点了给提示而不是进一个假的房间；
 * 2. 「本地双人」要 Draft 模式（P6），同样先给提示。
 */
export interface BattleMenuSceneProps {
  readonly profile: ProfileState;
  readonly onNavigate: (route: RouteId) => void;
}

interface Entry {
  readonly label: string;
  readonly hint: string;
  readonly glow: string;
  readonly route: RouteId | null;
  /** 常态亮着（旧版给「活动模式」开了 `persistent_glow`）。 */
  readonly persistent?: boolean;
}

const ENTRIES: readonly Entry[] = [
  {
    label: '单人战役',
    hint: '三章十二关，打赢拿金币与经验',
    glow: '#c83232',
    route: 'campaign',
  },
  {
    label: '活动模式',
    hint: '限时活动、迷宫与活动商店',
    glow: '#ffdc78',
    route: 'activity',
    persistent: true,
  },
  {
    label: '局域网 卡组对战',
    hint: '旧版走联机房间；本版本不提供冒充联机的入口（PLAN 第 6 节）',
    glow: '#c84632',
    route: null,
  },
  {
    label: '局域网 任选对战',
    hint: '旧版走联机房间；本版本不提供冒充联机的入口（PLAN 第 6 节）',
    glow: '#c85a32',
    route: null,
  },
  {
    label: '本地 任选对战（双人）',
    hint: '本地 Draft：28 张候选轮流选牌（计划在 P6 阶段实现）',
    glow: '#c86e32',
    route: null,
  },
  { label: '返回主菜单', hint: '回到主菜单', glow: '#6496ff', route: 'hub' },
];

export function BattleMenuScene({ profile, onNavigate }: BattleMenuSceneProps) {
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);
  const background = assetManifest.shared.menu['battle_menu_bg']?.url ?? null;
  const posters = menuPosters();

  return (
    <MenuChrome
      backgroundUrl={background}
      title="选择对战模式"
      status={
        <>
          <LevelBar level={profile.level} />
          <CurrencyBar currencies={profile.currencies} />
        </>
      }
    >
      <nav
        className="menu__columns"
        aria-label="对战模式"
        style={{
          ['--cols-x' as string]: '75%',
          ['--cols-y' as string]: '25%',
          /*
            **按钮比旧版的 300 宽**：旧版那 300 是按它自己的字号定的，
            而这里最长的标签「本地 任选对战（双人）」在 40 设计单位的字号下约 480。
            长度仍然**一致**（这一列全是这个宽度），只是不再是 300。
          */
          ['--entry-w' as string]: 480,
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
              persistent={entry.persistent ?? false}
              onClick={() => {
                if (entry.route) {
                  onNavigate(entry.route);
                  return;
                }
                // 旧版对未开放的项是「点了弹一句提示」，不是把按钮做成灰的
                pushToast(`${entry.label}：${entry.hint}`, 'info');
              }}
            />
          ))}
        </div>
      </nav>

      <PosterCarousel
        posters={posters}
        onSelect={(index) => onNavigate(POSTER_ROUTES[index] ?? 'campaign')}
        still={reduceMotion}
      />
    </MenuChrome>
  );
}
