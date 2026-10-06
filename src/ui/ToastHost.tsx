import { useToastStore } from '../state/toastStore';

/**
 * 轻提示的宿主。
 *
 * 挂在应用根部一次。它是失败路径的唯一出口：保存失败、余额不足、售罄、
 * 「待开发」——以前这些情况要么静默要么压根不存在。
 */
export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast--${toast.tone}`}
          onClick={() => dismiss(toast.id)}
          title="点击关闭"
        >
          {toast.message}
        </button>
      ))}
    </div>
  );
}
