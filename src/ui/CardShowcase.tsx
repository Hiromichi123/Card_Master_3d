import { useCallback, useEffect, useRef, useState } from 'react';

import { cardById } from '../data';
import { cardFaceUrl } from '../data/assets';
import { foilForRarity } from '../rendering/cards/foilModel';
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
 * **没有箔片的卡（D 档）走的是另一条路**：卡片照样跟着指针倒，
 * 但叠的是一层**跟着指针走的白色光斑**，不是彩色箔片——见 `.showcase__sheen`。
 * 早先这里把没有箔的卡直接从检视里排除了，表现就是「白卡是张死图片」。
 *
 * **左右三角形翻页。** 浏览顺序由调用方给（图鉴里就是当前筛选与排序下的列表），
 * 到头之后**首尾循环**，不会在两端卡住。切换是「旧卡飞出 → 新卡飞入」两段，
 * 时长见 `SWITCH_MS`，翻页期间再按不会打断（会重入的动画比不响应更难看）。
 */
export interface CardShowcaseProps {
  readonly cardId: string;
  /**
   * 可浏览的顺序。传空数组或只有一张时，左右按钮禁用。
   */
  readonly cardIds: readonly string[];
  /** 翻到另一张。选中状态由调用方持有，这边不自己存一份。 */
  readonly onSelect: (cardId: string) => void;
  readonly onClose: () => void;
}

/** 翻页方向：−1 上一张，+1 下一张。 */
type FlipDir = -1 | 1;

/**
 * 翻页动画的单程时长（毫秒）。
 *
 * **这个值是动画时长的唯一来源**：写成 `--switch-dur` 交给 CSS 的
 * `animation-duration`，两侧不会各写一个数然后对不上。
 */
const SWITCH_MS = 190;

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
    检视对**每一张卡**都开：没有箔片的卡也要跟着指针倒，
    只是它叠的是白光而不是彩色箔片。白卡本来就得靠「拿在手里」这个动作
    才不像一张贴纸。
  */
  useFoilPointer(cardRef);

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
    }, SWITCH_MS);
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
  const swingStyle = {
    ['--switch-dur' as string]: `${SWITCH_MS}ms`,
    ['--switch-travel' as string]: phase.kind === 'idle' ? -1 : -phase.dir,
  };

  const swingClass =
    phase.kind === 'out'
      ? 'showcase__swing showcase__swing--out'
      : phase.kind === 'in'
        ? 'showcase__swing showcase__swing--in'
        : 'showcase__swing';

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

          <div className="showcase__stage">
            {/* 飞行动画在**外一层**：卡片自己还要按指针倾斜，
                两种 transform 写同一个元素上会互相覆盖 */}
            <div className={swingClass} style={swingStyle}>
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
          <h2 className="showcase__name">{card.name}</h2>
          <p className="showcase__meta">
            {card.cardId} · {rarity}
          </p>
          {canFlip && (
            <p className="showcase__meta showcase__counter">
              {index + 1} / {cardIds.length}
            </p>
          )}
          <ul className="showcase__stats">
            <li>
              <b>{card.atk}</b>攻击
            </li>
            <li>
              <b>{card.hp}</b>生命
            </li>
            <li>
              <b>{card.cd}</b>冷却
            </li>
          </ul>
          <p className="showcase__meta">{card.rawTraits.join('、') || '没有特性'}</p>
          <p>{card.description}</p>
          <button type="button" className="btn showcase__close" onClick={onClose}>
            关闭（Esc）
          </button>
        </div>
      </div>
    </div>
  );
}
