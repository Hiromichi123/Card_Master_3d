import { assetManifest } from '../data/assets';
import { MenuChrome, MenuEntryButton } from '../ui/MenuChrome';
import { PlayerStatus } from '../ui/PlayerStatus';
import { PosterCarousel } from '../ui/PosterCarousel';
import { pushToast } from '../state/toastStore';
import { useSettingsStore } from '../state/settingsStore';
import { menuPosters, POSTER_ROUTES } from './menuPosters';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';

/**
 * 主菜单。1:1 照旧版 `scenes/menu.py`：
 *
 * - 整屏背景做视差、居中金色标题（12% 高、96 设计单位）+ 硬阴影；
 * - **两列阶梯按钮**：一级列 x = 70%、y = 25%，行距 90、每行左移 30；
 *   二级列 x = 一级列 + 按钮宽 300 + 两倍阶梯 60；
 * - 海报轮播 (58%, 60%)，尺寸 35% × 30%；
 * - 货币与等级在左上，版本号在右下。
 *
 * 坐标走「2880 × 1800 设计空间 + 整体等比缩放」（旧版 `config.py` 的
 * `AUTO_SCALE = min(比例)`），细节见 `MenuChrome`。
 *
 * ## 照搬不了的地方
 *
 * 1. **一级列**旧版是「进入战斗 / 抽卡 / 出战卡组配置 / 卡牌图鉴 / 设置 / 退出游戏」。
 *    网页没有「退出游戏」，那格留给项目本来就有的「重置存档」（同为危险操作、
 *    同样放最后一格）；本项目的「演示战斗」（P3 的固定 seed 对局）占掉第五格。
 *    「进入战斗」现在先进**选择对战模式**——旧版的一级第一项也是通向 `battle_menu`。
 * 2. **二级列**旧版是「活动入口 / 商店 / 工坊 / 公告 / 教学关卡」。
 *    二级列为「活动入口 / 商店 / 融合」。活动商店在活动大厅里；
 *    融合进入五槽实体卡祭坛，Draft 与迷宫入口已移除。
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
  { route: 'battlemenu', label: '进入战斗', hint: '选择对战模式', glow: '#c83232' },
  { route: 'gacha', label: '抽卡', hint: '八个卡池，概率由配置算出', glow: '#ff8c00' },
  { route: 'deck', label: '配置', hint: '最多 12 张，重复卡受拥有量限制', glow: '#6496ff' },
  { route: 'collection', label: '卡牌图鉴', hint: '按稀有度筛选，看清每一张的详情', glow: '#64c896' },
  { route: 'battle', label: '演示战斗', hint: '固定种子的对局，不影响存档', glow: '#a064ff' },
  { route: 'settings', label: '设置', hint: '画质、台面、视角与演出速度', glow: '#9664ff' },
];

const SECONDARY: readonly Entry[] = [
  { route: 'activity', label: '活动入口', hint: '限时活动与活动商店', glow: '#ffdc78' },
  { route: 'shop', label: '商店', hint: '每日货架，卖完即止', glow: '#b478ff' },
  { route: 'fusion', label: '融合', hint: '五槽祭坛，五张卡牌融合为一张随机卡牌', glow: '#78d2ff' },
];

export function HubScene({ profile, onNavigate, onReset }: HubSceneProps) {
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);
  const background = assetManifest.shared.menu['menu_bg']?.url ?? null;
  const posters = menuPosters();

  const entry = (item: Entry, row: number) => (
    <MenuEntryButton
      key={item.label}
      label={item.label}
      hint={item.hint}
      glow={item.glow}
      row={row}
      coming={item.coming ?? false}
      onClick={() => {
        if (item.route) {
          onNavigate(item.route);
          return;
        }
        // 旧版对未实现的入口是「点了给一句提示」，不是把按钮做成灰的
        pushToast(item.label + '即将开放', 'info');
      }}
    />
  );

  return (
    <MenuChrome
      className="menu--hub"
      backgroundUrl={background}
      title="Card Master 3D"
      status={<PlayerStatus level={profile.level} currencies={profile.currencies} />}
    >
      <nav className="menu__columns" aria-label="主菜单">
        <div className="menu__column">{PRIMARY.map((item, row) => entry(item, row))}</div>
        <div className="menu__column menu__column--side">
          {SECONDARY.map((item, row) => entry(item, row))}
        </div>
      </nav>

      <PosterCarousel
        posters={posters}
        onSelect={(index) => onNavigate(POSTER_ROUTES[index] ?? 'campaign')}
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

      <span className="menu__version">v1.3</span>
    </MenuChrome>
  );
}
