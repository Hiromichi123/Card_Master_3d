import { useEffect } from 'react';

import { hideCardTip, showCardTip, useCardTipStore } from '../state/cardTipStore';
import { CardHoverTip } from './CardHoverTip';

/**
 * 悬停详情的宿主。**全应用只挂一次**（在 `App` 里）。
 *
 * 它做两件事：
 *
 * 1. **挂一对全局监听**（`pointerover` / `pointerout`），往上找最近的
 *    `[data-card-id]`。任何卡片元素只要带这个属性就自动有详情——
 *    图鉴的小卡格、商店的货位、抽卡的展示卡与结果卡都是这么来的，
 *    各自一行 props 都不用写。
 * 2. 把当前这一张画出来（`CardHoverTip` 自己 portal 到 body）。
 *
 * **为什么用委托而不是给每个组件加 props**：卡面出现在五个界面里，
 * 逐个接一遍的结果就是「有几处忘了接」——组卡页那版还额外踩了
 * 「禁用的按钮不派发鼠标事件」，满卡组时整个失效。
 *
 * 监听挂在 `document` 上而不是某个容器：屏幕是挂载/卸载式的，
 * 挂在容器上就要求每块屏都记得挂一遍，又回到原问题。
 */
export function CardTipHost() {
  const target = useCardTipStore((state) => state.target);

  useEffect(() => {
    const onOver = (event: PointerEvent): void => {
      const element = event.target instanceof Element ? event.target : null;
      const card = element?.closest<HTMLElement>('[data-card-id]') ?? null;
      const cardId = card?.dataset['cardId'];
      if (!card || !cardId) {
        return;
      }
      showCardTip(cardId, card.getBoundingClientRect());
    };

    const onOut = (event: PointerEvent): void => {
      const element = event.target instanceof Element ? event.target : null;
      const card = element?.closest<HTMLElement>('[data-card-id]') ?? null;
      if (!card) {
        return;
      }
      // 在同一张卡内部移动时 relatedTarget 还在这张卡里，此时不该收起
      const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      if (next && card.contains(next)) {
        return;
      }
      hideCardTip();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
    };
  }, []);

  if (!target) {
    return null;
  }

  return <CardHoverTip cardId={target.cardId} rect={target.rect} />;
}
