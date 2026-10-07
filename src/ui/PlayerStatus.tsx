import { uiIconUrl } from '../data/assets';
import { nextLevelXp } from '../domain/progression/levels';
import type { Currencies, LevelState } from '../domain/progression/types';
import { CurrencyBar } from './CurrencyBar';

/**
 * 玩家状态面板：**头像 + 等级 + 经验 + 资源**，一块板子。
 *
 * 照旧版 `ui/system_ui.py` 的 `CurrencyLevelUI` 画：一个深色圆角面板，
 * 左边是默认头像（等级压在其右下角），右边上排是经验条（`xp/need` 写在条内），
 * 下排是资源行（图标 + 数字）。
 *
 * 为什么值得单独抽一个组件：2026-10-07 之前，这一块在七个屏里是**三种画法**——
 * 主菜单等屏是「外层一个板子 + 里面一条 12px 的 XP 细条 + 三颗药丸」，
 * 商店/战役/迷宫是同一套但字号又各写各的，而融合与抽卡只有药丸没有等级。
 * 在 2880 × 1800 的设计空间里那些写死的 12/13px 还显得特别小。
 * 现在所有屏都渲染这一个组件，尺寸全部走设计单位（`calc(N * var(--ui))`）。
 *
 * 三个资源图标与默认头像都是原项目的素材（`assets/ui/`），
 * 由 `scripts/prepare-assets.py` 转成 webp 后进 manifest。
 * 数值仍然由调用方传（存档是唯一真相），这里不读 store。
 */
export interface PlayerStatusProps {
  readonly level: LevelState;
  readonly currencies: Currencies;
}

export function PlayerStatus({ level, currencies }: PlayerStatusProps) {
  const need = nextLevelXp(level);
  const ratio = need > 0 ? Math.max(0, Math.min(1, level.xp / need)) : 0;
  const avatar = uiIconUrl('avatar');

  return (
    <div className="player" aria-label="玩家状态">
      <div className="player__avatar">
        {avatar ? (
          <img src={avatar} alt="" draggable={false} />
        ) : (
          <span className="player__avatar-fallback" aria-hidden="true" />
        )}
        <span className="player__level">Lv {level.level}</span>
      </div>

      <div className="player__body">
        <div className="player__xp" aria-label="经验">
          <span className="player__xp-label">XP</span>
          <span className="player__xp-track">
            <span className="player__xp-fill" style={{ width: `${ratio * 100}%` }} />
            {/* 数值写在条内、居中——旧版就是这么画的，条本身不用再拉长就能读 */}
            <span className="player__xp-value">
              {level.xp}/{need}
            </span>
          </span>
        </div>

        <CurrencyBar currencies={currencies} />
      </div>
    </div>
  );
}
