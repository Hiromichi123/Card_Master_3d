import { create } from 'zustand';

/**
 * 轻提示。
 *
 * 用 zustand 而不是像 `ProfileStore` 那样手写一个类：这是**运行期低频 UI 状态**，
 * 不落盘、不参与事务、也不需要被 React 之外的东西同步读取——
 * 正是 zustand 擅长的那一类。
 *
 * 必须有的理由：失败路径得有出口。保存失败、余额不足、售罄、待开发入口，
 * 这四种情况以前只能静默失败或者根本不存在。
 */

export type ToastTone = 'info' | 'error';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

interface ToastState {
  readonly toasts: readonly Toast[];
  readonly push: (message: string, tone?: ToastTone) => void;
  readonly dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'info') => {
    const id = nextId;
    nextId += 1;
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    // 自己消失；错误留久一点，好让人看清
    setTimeout(
      () => {
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
      },
      tone === 'error' ? 5200 : 3000,
    );
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** React 之外也能用的入口（`ProfileStore` 的 notice 就走它）。 */
export function pushToast(message: string, tone: ToastTone = 'info'): void {
  useToastStore.getState().push(message, tone);
}
