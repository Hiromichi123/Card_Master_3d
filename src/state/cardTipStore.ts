import { create } from 'zustand';

/**
 * 全局的「悬停卡牌详情」。
 *
 * **做成全局是为了只实现一次。** 卡面出现在图鉴、组卡、商店、抽卡结果与
 * 3D 演出里——每个界面各接一遍悬停，迟早有几处漏掉或者行为不一致
 * （组卡页那版就是因为「满卡组时每张收藏卡都是 `disabled`」而整个失效）。
 *
 * 触发方式有两条，最终都落到这个 store：
 *
 * 1. **DOM 侧用事件委托**（`CardTipHost` 只挂一次全局监听）：
 *    `pointerover` 冒泡到 document，往上找最近的 `[data-card-id]` 就完事——
 *    于是任何带这个属性的卡片元素**自动**有详情，不需要各自接 props；
 * 2. **3D 侧**（`GachaCard`）拿不到 DOM 委托，在 `onPointerOver/Out` 里直接调。
 *
 * 只存卡片 id 与它当时的矩形：位置由宿主算，跟着卡片贴边，
 * 不跟着鼠标飘（鼠标一动框就动，反而看不清）。
 */
export interface CardTipTarget {
  readonly cardId: string;
  /** 被悬停元素的位置快照。 */
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

interface CardTipState {
  readonly target: CardTipTarget | null;
  show: (cardId: string, rect: DOMRect) => void;
  hide: () => void;
}

export const useCardTipStore = create<CardTipState>((set) => ({
  target: null,
  show: (cardId, rect) =>
    set({
      target: {
        cardId,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      },
    }),
  hide: () => set({ target: null }),
}));

/**
 * 非 React 入口：3D 侧（R3F 的指针事件）与原生监听都用它。
 */
export function showCardTip(cardId: string, rect: DOMRect): void {
  useCardTipStore.getState().show(cardId, rect);
}

export function hideCardTip(): void {
  useCardTipStore.getState().hide();
}
