import { useCallback, useEffect, useRef, useState } from 'react';

import { cardById } from '../data';
import { cardFaceUrl } from '../data/assets';
import { foilForRarity } from '../rendering/cards/foilModel';
import { statColor } from '../rendering/cards/statColors';
import { useRarityIndex } from '../state/useRarityIndex';
import { useFoilPointer } from './useFoilPointer';

/**
 * 卡牌展示位。
 *
 * 点开一张卡之后，背景压暗、卡牌放大到屏幕正中，按**实体卡**来呈现：
 * 有厚度与边缘高光、跟着指针倒、箔片的反光和眩光跟着指针走。
 *
 * **箔片只在这一处出现。** 网格里的缩略图是纯图片——一屏几十张同时闪
 * 既吵又费合成，而且缩略图尺寸下条纹根本读不出来（`V-HOLO-4`：
 * 箔片只在战斗卡面与展示位使用）。
 *
 * 检视的映射与 3D 卡的着色器共用 `foilModel`：这边指针在卡面上走，
 * 那边相机绕着卡转，两边拿到的是同一个 `FoilView`。
 *
 * **没有箔片的卡（D 档）走的是另一条路**：倾斜照旧，但叠的不是彩色箔片，
 * 而是一层**只跟指针走的白光**（`.showcase__sheen`）。之前这一档完全没有检视——
 * 指针扫过毫无反应，白卡在展示位里就是一张死图片。
 *
 * 结构上有一条硬要求：**卡片必须是 `.showcase__stage` 的直接子元素**。
 * `perspective` 只作用于直接子元素，中间夹一层（哪怕只是 `transform-style: preserve-3d`）
 * 都会改变投影，所有卡的倾斜幅度都会跟着变。左右翻页的动画因此挂在**舞台**上，
 * 而不是给卡片再包一层。
 */
export interface CardShowcaseProps {
  readonly cardId: string;
  /**
   * 可浏览的顺序。只有一张时左右按钮禁用。
   */
  readonly cardIds: readonly string[];
  /** 翻到另一张。选中状态由调用方持有，这边不自己存一份。 */
  readonly onSelect: (cardId: string) => void;
  readonly onClose: () => void;
}

/** 翻页方向：−1 上一张，+1 下一张。 */
type FlipDir = -1 | 1;

/**
 * 翻页动画单程时长（毫秒）。**这是动画时长的唯一来源**：
 * 写成 `--switch-dur` 交给 CSS 的 `animation-duration`，两侧不会各写一个数然后对不上。
 *
 * **两段故意不一样长**：旧卡是「被推走」，快一点（加速离开）；
 * 新卡是「滑到位」，慢一点（减速停下）。一样长的话整段读起来是匀速平移，
 * 没有「停稳」的感觉。
 */
const SWITCH_OUT_MS = 170;
const SWITCH_IN_MS = 210;

type SwitchPhase =
  | { readonly kind: 'idle' }
  /** 当前卡正在飞出。 */
  | { readonly kind: 'out'; readonly dir: FlipDir }
  /** 新卡正在飞入。 */
  | { readonly kind: 'in'; readonly dir: FlipDir };

export function CardShowcase({ cardId, cardIds, onSelect, onClose }: CardShowcaseProps) {
  const card = cardById.get(cardId);
  const rarityIndex = useRarityIndex();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<SwitchPhase>({ kind: 'idle' });
  /** 飞到一半的那张卡是谁。飞出结束时才真正换卡。 */
  const pendingRef = useRef<{ readonly dir: FlipDir; readonly cardId: string } | null>(null);
  /** 动画期间挡住重复触发。用 ref 而不是读 `phase`：翻页是事件驱动的，不等重渲染。 */
  const busyRef = useRef(false);

  const rarity = card?.rarity ?? 'D';
  const rarityColor = rarityIndex.colorOf(rarity);
  const foil = foilForRarity(rarity, rarityColor);
  const hasFoil = foil.kind !== 'none';

  /*
    检视对**每一张卡**都开。有箔片的卡本来就走这条路（行为与之前完全一致），
    变了的是没有箔片的 D 档：它们现在也跟随指针倒下，只是上面叠的是白光。
  */
  useFoilPointer(cardRef, true);

  const canFlip = cardIds.length > 1;
  const index = Math.max(0, cardIds.indexOf(cardId));

  const flip = useCallback(
    (dir: FlipDir): void => {
      if (busyRef.current || cardIds.length < 2) {
        return;
      }
      const from = cardIds.indexOf(cardId);
      if (from < 0) {
        return;
      }
      // 首尾循环：到末张再往下一张回到第一张，往上一张回到末张
      const next = cardIds[(from + dir + cardIds.length) % cardIds.length];
      busyRef.current = true;
      pendingRef.current = { dir, cardId: next ?? cardId };
      setPhase({ kind: 'out', dir });
    },
    [cardIds, cardId],
  );

  /*
    两段动画用一个定时器接力，不用 `animationend`：
    时长从 `SWITCH_MS` 一个常量出，不会出现「CSS 改了、TS 没改」而卡住的情况，
    也不受 `prefers-reduced-motion` 把动画压成 0 帧的影响（那样事件根本不触发）。
  */
  useEffect(() => {
    if (phase.kind === 'idle') {
      busyRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if (phase.kind === 'out') {
        const pending = pendingRef.current;
        if (pending) {
          onSelect(pending.cardId);
          setPhase({ kind: 'in', dir: pending.dir });
          return;
        }
      }
      setPhase({ kind: 'idle' });
    }, phase.kind === 'in' ? SWITCH_IN_MS : SWITCH_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, onSelect]);

  // Esc 关闭、左右方向键翻页。展示位盖住了整页，没有键盘出口会很难受
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft') {
        flip(-1);
      } else if (event.key === 'ArrowRight') {
        flip(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, flip]);

  if (!card) {
    return null;
  }

  // 大图用 detail 档：这一处是玩家唯一会盯着看的画面，
  // 用缩略图会糊（纹理预算上只看一张，代价可以接受）
  const url = cardFaceUrl(cardId, 'detail') ?? cardFaceUrl(cardId, 'battle');

  /*
    色带配色**内联**而不是写成 CSS 类：每个稀有度的代表色都不同，
    为 13 个稀有度各写一个类是没必要的重复。
    色值来自 `rarities.json`，与卡牌外圈光晕同源。
  */
  const foilStyle = {
    ['--foil-strength' as string]: foil.strength,
    ['--foil-c1' as string]: foil.palette[0],
    ['--foil-c2' as string]: foil.palette[1],
    ['--foil-c3' as string]: foil.palette[2],
    ['--foil-c4' as string]: foil.palette[3],
    ['--foil-c5' as string]: foil.palette[4],
    ['--foil-c6' as string]: foil.palette[5],
  };

  /*
    飞行的方向：下一张时两张都往左走（旧的飞出左边、新的从右边进来）。
    CSS 的 keyframes 只写一套，靠这个符号分左右。
  */
  const stageStyle = {
    ['--switch-dur' as string]: `${phase.kind === 'in' ? SWITCH_IN_MS : SWITCH_OUT_MS}ms`,
    ['--switch-travel' as string]: phase.kind === 'idle' ? -1 : -phase.dir,
  };

  /*
    静止时**一个动画相关的类都不加**：`.showcase__stage` 回到和以前一模一样的
    计算样式，卡片的投影、倾斜、箔片合成都不受这套翻页影响。
  */
  const stageClass =
    phase.kind === 'out'
      ? 'showcase__stage showcase__stage--out'
      : phase.kind === 'in'
        ? 'showcase__stage showcase__stage--in'
        : 'showcase__stage';

  return (
    <div
      className="showcase"
      role="dialog"
      aria-label={`${card.name} 展示`}
      onClick={(event) => {
        // 点背景关闭；点卡片本身不关
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="showcase__inner">
        {/* 这一层只是排版（左右各留一列放三角形）：没有 transform / filter /
            透明度，不会给卡片另建一个渲染上下文 */}
        <div className="showcase__viewport">
          <button
            type="button"
            className="showcase__nav showcase__nav--prev"
            onClick={() => flip(-1)}
            disabled={!canFlip}
            aria-label="上一张"
            title="上一张（←）"
          >
            <span className="showcase__nav-tri" aria-hidden="true" />
          </button>

          <div className={stageClass} style={stageStyle}>
            <div ref={cardRef} className="showcase__card">
              {url ? (
                <img className="showcase__art" src={url} alt={card.name} draggable={false} />
              ) : (
                <span
                  className="tile__plate"
                  style={{ background: rarityIndex.colorOf(rarity) }}
                  aria-hidden="true"
                >
                  <span className="tile__rarity">{rarity}</span>
                  <span className="tile__name">{card.name}</span>
                </span>
              )}

              {hasFoil ? (
                <span className={`foil foil--${foil.kind}`} style={foilStyle} aria-hidden="true" />
              ) : (
                /* 没有箔片的卡：只叠一层跟着指针走的白光 */
                <span className="showcase__sheen" aria-hidden="true" />
              )}

              {/* 边缘高光与内描边：读起来像有厚度的成品卡，而不是一张图片 */}
              <span className="showcase__edge" aria-hidden="true" />
            </div>
          </div>

          <button
            type="button"
            className="showcase__nav showcase__nav--next"
            onClick={() => flip(1)}
            disabled={!canFlip}
            aria-label="下一张"
            title="下一张（→）"
          >
            <span className="showcase__nav-tri" aria-hidden="true" />
          </button>
        </div>

        <div className="showcase__info">
          {/* 名称用该稀有度的代表色（与卡牌外圈光晕同源），字体是宋体加粗 */}
          <h2 className="showcase__name" style={{ color: rarityColor }}>
            {card.name}
          </h2>
          <p className="showcase__meta">
            {card.cardId} · {rarity}
          </p>
          {canFlip && (
            <p className="showcase__meta showcase__counter">
              {index + 1} / {cardIds.length}
            </p>
          )}
          {/*
            数值配色与战斗卡面上的徽标**同一份**（`statColors.ts`）：
            攻=红、血=绿、冷却=蓝。两边不一致的话，玩家会以为不是同一个数。
          */}
          <ul className="showcase__stats">
            <li>
              <b style={{ color: statColor('atk') }}>{card.atk}</b>攻击
            </li>
            <li>
              <b style={{ color: statColor('hp') }}>{card.hp}</b>生命
            </li>
            <li>
              <b style={{ color: statColor('cd') }}>{card.cd}</b>冷却
            </li>
          </ul>
          <p className="showcase__meta">{card.rawTraits.join('、') || '没有特性'}</p>
          <p className="showcase__desc">{card.description}</p>
          <button type="button" className="btn showcase__close" onClick={onClose}>
            关闭（Esc）
          </button>
        </div>
      </div>
    </div>
  );
}
