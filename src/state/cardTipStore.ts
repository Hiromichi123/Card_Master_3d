import { create } from 'zustand';
import type { AttackStatusKind, CardDefinition } from '../domain/cards/types';

export interface CardTipDetails {
  readonly ownerKey?: string | undefined;
  readonly ownerElement?: Element | undefined;
  readonly source?: 'dom' | '3d' | undefined;
  readonly card?: CardDefinition | undefined;
  readonly stats?: { readonly atk: number; readonly hp: number; readonly cd: number } | undefined;
  readonly attackStatuses?: readonly AttackStatusKind[] | undefined;
  readonly flying?: boolean | undefined;
  readonly unyielding?: boolean | undefined;
}
export interface CardTipTarget extends CardTipDetails {
  readonly cardId: string;
  readonly pointer: { readonly x: number; readonly y: number };
}
type Anchor = { readonly x: number; readonly y: number } | {
  readonly left: number; readonly top: number; readonly right: number; readonly bottom: number;
};
interface CardTipState {
  readonly target: CardTipTarget | null;
  show: (cardId: string, anchor: Anchor, details?: CardTipDetails) => void;
  hide: (ownerKey?: string) => void;
}
export function cardTipsSuppressed(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[data-card-tip-scope="off"]') !== null;
}
export const useCardTipStore = create<CardTipState>((set, get) => ({
  target: null,
  show: (cardId, anchor, details = {}) => {
    if (cardTipsSuppressed()) return;
    const pointer = 'x' in anchor ? anchor : { x: anchor.right, y: anchor.top };
    set({ target: { cardId, pointer, ...details } });
  },
  hide: (ownerKey) => {
    const target = get().target;
    if (target && (ownerKey === undefined || target.ownerKey === ownerKey)) set({ target: null });
  },
}));
export function showCardTip(cardId: string, anchor: Anchor, details?: CardTipDetails): void {
  useCardTipStore.getState().show(cardId, anchor, details);
}
export function hideCardTip(ownerKey?: string): void { useCardTipStore.getState().hide(ownerKey); }
export function moveCardTip(x: number, y: number): void {
  const target = useCardTipStore.getState().target;
  if (target && (target.pointer.x !== x || target.pointer.y !== y))
    useCardTipStore.setState({ target: { ...target, pointer: { x, y } } });
}
export function refreshCardTip(ownerKey: string, details: CardTipDetails): void {
  const target = useCardTipStore.getState().target;
  if (target?.ownerKey === ownerKey) useCardTipStore.setState({ target: { ...target, ...details } });
}
