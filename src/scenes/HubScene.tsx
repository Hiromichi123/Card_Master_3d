import { CurrencyBar } from '../ui/CurrencyBar';
import { ComingSoonBadge } from '../ui/ComingSoonBadge';
import { LevelBar } from '../ui/LevelBar';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';

/**
 * 主界面。
 *
 * 入口分组照搬旧版 `scenes/menu.py`：一级是「进入战斗 / 抽卡 / 出战卡组配置 /
 * 卡牌图鉴 / 设置」，二级是「活动入口 / 商店 / 工坊 / 公告 / 教学关卡」。
 *
 * 两处按本项目的实际进度改了：
 *
 * - 旧版的「进入战斗」先过一个「选择对战模式」（单人战役 / 局域网 / 本地双人）。
 *   **局域网不在本轮范围**（PLAN 第 6 节明确不提供冒充联机的入口），
 *   所以这里直接进战役，少一层没有内容的菜单。
 * - 「工坊 / 活动 / 公告 / 教学关卡」在 P6，列出来但**明确禁用并标注待开发**，
 *   而不是藏起来——藏起来的话，玩家不知道这些东西存在，
 *   评审也看不出哪些是本轮范围外的。
 *
 * 另外保留「演示战斗」：那是 P3 的固定 seed 对局，用来快速看一局演出，
 * 与战役的关卡是两条路。
 */

export interface HubSceneProps {
  readonly profile: ProfileState;
  readonly onNavigate: (route: RouteId) => void;
}

interface Entry {
  readonly route: RouteId;
  readonly label: string;
  readonly hint: string;
  readonly accent: string;
}

const PRIMARY: readonly Entry[] = [
  { route: 'campaign', label: '进入战斗', hint: '三章十二关，打赢拿金币与经验', accent: 'red' },
  { route: 'gacha', label: '抽卡', hint: '八个卡池，概率由配置算出', accent: 'orange' },
  { route: 'deck', label: '出战卡组配置', hint: '最多 12 张，重复卡受拥有量限制', accent: 'blue' },
  { route: 'collection', label: '卡牌图鉴', hint: '按稀有度筛选，看清每一张的详情', accent: 'green' },
  { route: 'shop', label: '商店', hint: '每日货架，卖完即止', accent: 'cyan' },
  { route: 'settings', label: '设置', hint: '画质、台面、视角与演出速度', accent: 'purple' },
];

const DEMO: readonly Entry[] = [
  { route: 'battle', label: '演示战斗', hint: '固定种子的对局，不影响存档', accent: 'slate' },
];

const COMING: readonly { label: string; hint: string }[] = [
  { label: '融合', hint: '五槽融合，消耗卡牌换取更高稀有度' },
  { label: '自选对战', hint: '本地双人自选牌组' },
  { label: 'Draft', hint: '28 张候选轮流选牌' },
  { label: '迷宫', hint: '第一层迷宫探索与节点战斗' },
];

export function HubScene({ profile, onNavigate }: HubSceneProps) {
  const activeDeck = profile.decks.find((deck) => deck.id === profile.activeDeckId) ?? null;

  return (
    <div className="screen hub">
      <header className="screen__head hub__head">
        <div>
          <h1 className="hub__title">Card Master 3D</h1>
          <p className="hub__subtitle">
            当前出战：{activeDeck ? `${activeDeck.name}（${activeDeck.cardIds.length} 张）` : '未选择卡组'}
          </p>
        </div>
        <div className="hub__status">
          <LevelBar level={profile.level} />
          <CurrencyBar currencies={profile.currencies} />
        </div>
      </header>

      <div className="hub__columns">
        <section className="hub__group" aria-label="主要入口">
          {PRIMARY.map((entry) => (
            <button
              key={entry.route}
              type="button"
              className={`hub__entry hub__entry--${entry.accent}`}
              onClick={() => onNavigate(entry.route)}
              title={entry.hint}
            >
              <span className="hub__entry-label">{entry.label}</span>
              <span className="hub__entry-hint">{entry.hint}</span>
            </button>
          ))}
        </section>

        <section className="hub__group hub__group--side" aria-label="其它入口">
          {DEMO.map((entry) => (
            <button
              key={entry.route}
              type="button"
              className={`hub__entry hub__entry--${entry.accent} hub__entry--small`}
              onClick={() => onNavigate(entry.route)}
              title={entry.hint}
            >
              <span className="hub__entry-label">{entry.label}</span>
              <span className="hub__entry-hint">{entry.hint}</span>
            </button>
          ))}

          {COMING.map((entry) => (
            <button
              key={entry.label}
              type="button"
              className="hub__entry hub__entry--locked hub__entry--small"
              disabled
              title={`${entry.hint}（计划在 P6 阶段实现）`}
            >
              <span className="hub__entry-label">
                {entry.label}
                <ComingSoonBadge />
              </span>
              <span className="hub__entry-hint">{entry.hint}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
