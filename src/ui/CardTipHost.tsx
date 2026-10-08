import { useEffect } from 'react';
import { cardTipsSuppressed, hideCardTip, moveCardTip, showCardTip, useCardTipStore } from '../state/cardTipStore';
import { CardHoverTip } from './CardHoverTip';

/** One application-wide host for both DOM thumbnails and Three.js card faces. */
export function CardTipHost() {
  const target = useCardTipStore((state) => state.target);
  useEffect(() => {
    const owners = new WeakMap<Element, string>();
    let counter = 0;
    let frame = 0;
    let pending: PointerEvent | null = null;
    const ownerKey = (element: Element): string => {
      let key = owners.get(element);
      if (!key) { key = `dom-card-${++counter}`; owners.set(element, key); }
      return key;
    };
    const cardElement = (target: EventTarget | null): HTMLElement | null => target instanceof Element
      ? target.closest<HTMLElement>('[data-card-id]') : null;
    const showDOM = (event: PointerEvent): boolean => {
      const element = cardElement(event.target);
      const cardId = element?.dataset['cardId'];
      if (!element || !cardId) return false;
      showCardTip(cardId, { x: event.clientX, y: event.clientY },
        { ownerKey: ownerKey(element), ownerElement: element, source: 'dom' });
      return true;
    };
    const over = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      if (cardTipsSuppressed()) { hideCardTip(); return; }
      showDOM(event);
    };
    const out = (event: PointerEvent): void => {
      if (event.relatedTarget === null) { hideCardTip(); return; }
      const element = cardElement(event.target);
      if (!element) return;
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      hideCardTip(ownerKey(element));
    };
    const move = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      pending = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = pending;
        if (!next) return;
        if (cardTipsSuppressed()) { hideCardTip(); return; }
        if (showDOM(next)) return;
        const active = useCardTipStore.getState().target;
        if (active?.source === '3d' && active.ownerElement === next.target) moveCardTip(next.clientX, next.clientY);
        else if (active) hideCardTip(active.ownerKey);
      });
    };
    const hide = (): void => hideCardTip();
    const observer = new MutationObserver(() => {
      const active = useCardTipStore.getState().target;
      if (active && (cardTipsSuppressed() || active.ownerElement?.isConnected === false)) hideCardTip();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
      hideCardTip();
    };
  }, []);
  return target ? <CardHoverTip target={target} /> : null;
}
