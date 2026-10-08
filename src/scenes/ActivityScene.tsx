import { useRef, useState } from 'react';

import { backgroundUrl } from '../data/assets';
import { MenuChrome, MenuEntryButton } from '../ui/MenuChrome';
import { PlayerStatus } from '../ui/PlayerStatus';
import { SelectionWheel, type WheelItem } from '../ui/SelectionWheel';
import { usePageWheel } from '../ui/usePageWheel';
import { pushToast } from '../state/toastStore';
import { useSettingsStore } from '../state/settingsStore';
import type { ProfileState } from '../domain/progression/types';
import type { RouteId } from '../app/routes';

/**
 * 限时活动模式（活动大厅）。
 *
 * 2026-10-08 改造：原来的**三张静态特性卡**换成**滚轮**（复用抽卡主界面的
 * 倾斜立牌，见 `ui/SelectionWheel`）。动机有两条，都是用户提的：
 *
 * 1. **滚轮切换、点击切换**，并**切到哪个模式就换哪张背景**
 *    （照抽卡页：选卡池即换背景）。背景交给 `MenuChrome` 的 `backgroundUrl`，
 *    底部是 `CrossfadeBackground`，换 URL 自带 0.32 秒交叉淡化。
 * 2. **全页滚轮**：指针在页面任何位置滚都算，不必先对准轮盘（`ui/usePageWheel`）。
 *
 * ## 选中与进入是两件事
 *
 * 滚轮只管「选中」——换背景、换说明。进入要靠面板上的「进入」按钮。
 * 这与抽卡页一致（选卡池 ≠ 抽卡），也避免玩家滚过一页就误入迷宫。
 *
 * 三个旧模式（迷宫 / 深渊 / 协力）加两个新的（天梯赛 / 极难挑战）共五个，
 * 只有迷宫做完了；其余四个按既有约定：**给提示，不做成灰按钮**。
 */

interface ActivityMode {
  readonly id: string;
  readonly title: string;
  readonly desc: string;
  readonly schedule: string;
  /** `bg/xxx` → manifest 键 `xxx_bg`（见 `data/assets.ts` 的 `backgroundUrl`）。 */
  readonly bgType: string;
  /** 做完了才有路由；没有的点「进入」给一句提示。 */
  readonly route: RouteId | null;
}

/**
 * 五个活动模式。`bgType` 指向**复制出来并重新命名**的那几张图
 * （`public/assets/bg/activity_*_bg.webp`）——日后换图直接替换同名文件即可，
 * 不用改代码。
 */
const MODES: readonly ActivityMode[] = [
  {
    id: 'maze',
    title: '迷宫挑战',
    desc: '进入限时迷宫，连续挑战三个阶段首领，获得最终奖励。',
    schedule: '活动期间常驻开放',
    bgType: 'bg/activity_maze',
    route: 'maze',
  },
  {
    id: 'abyss',
    title: '深渊挑战',
    desc: '携带自定义卡组车轮战挑战多层深渊，获取稀有奖励。',
    schedule: '每周开放 3 个全新层级',
    bgType: 'bg/activity_abyss',
    route: null,
  },
  {
    id: 'coop',
    title: '协力突袭',
    desc: '匹配其他玩家共同击破巨型敌人，分享掉落。',
    schedule: '周末限时开放',
    bgType: 'bg/activity_coop',
    route: null,
  },
  {
    id: 'ladder',
    title: '天梯赛',
    desc: '与全服玩家排位对决，按胜场结算赛季排名与专属头像框。',
    schedule: '赛季结算，每两周一轮',
    bgType: 'bg/activity_ladder',
    route: null,
  },
  {
    id: 'extreme',
    title: '极难挑战',
    desc: '面对大幅强化过的敌阵，限一次通关机会，成功即得极限称号。',
    schedule: '不定期开放，持续 72 小时',
    bgType: 'bg/activity_extreme',
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

/**
 * 滚轮舞台在设计单位里的高度。
 *
 * **必须与 `global.css` 里 `.menu .activity-wheel` 的 `height` 一致**——
 * 组件用它算「选中行在哪」（选中项固定在正中），对不上的话选中项会偏出可视区。
 * 1300 这个数还有一个用处：五个模式总高 4×140+120 = 680，
 * 无论选中哪一个，整列都落在舞台内**不会被裁**（这是「显示不全」的另一半修复）。
 */
const ACTIVITY_WHEEL_HEIGHT = 1300;

export interface ActivitySceneProps {
  readonly profile: ProfileState;
  readonly onNavigate: (route: RouteId) => void;
}

export function ActivityScene({ profile, onNavigate }: ActivitySceneProps) {
  const [index, setIndex] = useState(0);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const still = useSettingsStore((state) => state.reduceMotion);
  const mode = MODES[index] ?? MODES[0]!;

  /*
    全页滚轮。`setIndex` 自己做夹取——滚到尽头不该回绕，也不该越界。
    这里不做「换方向清零」之类的花活，那些在 `usePageWheel` 里。
  */
  usePageWheel({
    ref: pageRef,
    onStep: (delta) => {
      setIndex((current) => Math.max(0, Math.min(MODES.length - 1, current + delta)));
    },
  });

  const items: WheelItem[] = MODES.map((entry) => ({
    id: entry.id,
    name: entry.title,
    coming: entry.route === null,
  }));

  const enter = (): void => {
    if (mode.route) {
      onNavigate(mode.route);
      return;
    }
    pushToast(`${mode.title} 将随版本更新开放`, 'info');
  };

  return (
    <MenuChrome
      backgroundUrl={backgroundUrl(mode.bgType)}
      rootRef={pageRef}
      title="限时活动模式"
      titleSize={86}
      subtitle="限时玩法与合作挑战在此汇集，完成目标可兑换限定卡牌奖励。"
      status={<PlayerStatus level={profile.level} currencies={profile.currencies} />}
    >
      <SelectionWheel
        variant="activity-wheel"
        ariaLabel="活动模式"
        still={still}
        items={items}
        activeIndex={index}
        onSelect={setIndex}
        /* 活动大厅的设计框不整体缩放，位移要写成 calc(N * var(--ui)) */
        lengthUnit="var(--ui)"
        /* 与 CSS 里 `.menu .activity-wheel { height }` 必须一致 */
        stageHeight={ACTIVITY_WHEEL_HEIGHT}
        /*
          未实现的模式在这里标「未开放」，而不是复用 `ComingSoonBadge`
          ——那个组件的 tooltip 写死了「计划在 P6 阶段实现」，而这四个新模式
          并没有排在任何一个阶段上，用它等于说了一句不准确的话。
        */
        renderBadge={(item) => (item.coming ? <span className="activity-wheel__soon">未开放</span> : null)}
      />

      <section className="activity-detail" aria-label="活动详情">
        <h2 className="activity-detail__title">
          {mode.title}
          {mode.route === null && <span className="activity-detail__soon">未开放</span>}
        </h2>
        <p className="activity-detail__desc">{mode.desc}</p>
        <p className="activity-detail__schedule">{mode.schedule}</p>
        <button type="button" className="activity-detail__enter" onClick={enter}>
          {mode.route ? '进入' : '尚未开放'}
        </button>
      </section>

      <nav
        className="menu__columns activity-entries"
        aria-label="活动入口"
        style={{
          /*
            位置（86% / 25%）写在 `global.css` 的 `.menu .activity-entries` 里——
            与滚轮、详情面板同一处看，三者的横向关系才看得出来。
            这里原来还传了 `--cols-x: 80%` / `--cols-y: 30%`，但**没有任何 CSS
            读它们**（见那条规则的注释），渲染出来的其实是 `.menu__columns` 的
            70%/25%；2026-10-09 一并删掉，别留一个看着像生效的假坐标。
          */
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
