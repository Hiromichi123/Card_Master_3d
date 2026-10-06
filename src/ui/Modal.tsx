import { useEffect, type ReactNode } from 'react';

/**
 * 模态。
 *
 * 复用既有那套 `.overlay` / `.overlay__panel`（战斗结果页已经在用），
 * 但**必须加 `.overlay--fixed`**：基础类里是 `position: absolute`，
 * 它只在 `.scene-viewport` 这种有定位祖先的容器里才摆得对。
 * 菜单类屏幕没有那样的祖先，直接套基础类会跑到视口之外或者盖错地方。
 *
 * 没有焦点陷阱——这个项目的界面里没有需要精确焦点管理的表单；
 * 但 **Esc 关闭**是必须的，因为模态下面的界面此时不可点。
 */
export interface ModalProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  /** 底部操作区。 */
  readonly footer?: ReactNode | undefined;
  readonly wide?: boolean | undefined;
}

export function Modal({ title, children, onClose, footer, wide }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay overlay--fixed" role="presentation">
      <div
        className={wide ? 'overlay__panel overlay__panel--wide' : 'overlay__panel'}
        role="dialog"
        aria-label={title}
      >
        <header className="modal__head">
          <h2 className="overlay__title modal__title">{title}</h2>
          <button type="button" className="btn modal__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <div className="overlay__actions modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
