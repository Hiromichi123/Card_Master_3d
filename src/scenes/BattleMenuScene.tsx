import { assetManifest } from '../data/assets';
import { MenuChrome, MenuEntryButton } from '../ui/MenuChrome';
import { PosterCarousel } from '../ui/PosterCarousel';
import { PlayerStatus } from '../ui/PlayerStatus';
import { pushToast } from '../state/toastStore';
import { useSettingsStore } from '../state/settingsStore';
import { menuPosters, POSTER_ROUTES } from './menuPosters';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';

/**
 * 旧版 battle_menu.py 的背景、标题、按钮位置与海报轮播。
 * 本地任选对战接入交替选卡和同机双人战桌；局域网入口仍只显示未开放提示。
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
    hint: '限时活动与活动商店',
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
    hint: '28 张候选轮流选牌，各选 12 张；支持双人手动操作与上方 AI',
    glow: '#c86e32',
    route: 'localBattle',
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
          <PlayerStatus level={profile.level} currencies={profile.currencies} />
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
