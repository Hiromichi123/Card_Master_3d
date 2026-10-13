import { audioEngine, type AudioEngine } from './AudioEngine';

const BUTTONS = 'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]';

/** 捕获监听覆盖登录、场景与 portal，不改各按钮的业务回调。 */
export function attachUiClickSound(
  target: Document = document,
  engine: Pick<AudioEngine, 'unlocked' | 'resume' | 'play'> = audioEngine,
): () => void {
  let active = true;
  let request = 0;
  const keyboardAt = new WeakMap<Element, number>();
  const buttonFor = (event: Event): Element | null => {
    const origin = event.target as Element | null;
    const button = origin?.closest?.(BUTTONS);
    if (!button || button.matches(':disabled') || button.closest('[inert], [aria-disabled="true"]')) return null;
    return button;
  };
  const play = (): void => {
    const id = ++request;
    if (engine.unlocked) {
      engine.play('uiClick', { gain: .65 });
      return;
    }
    const at = Date.now();
    void engine.resume().then(() => {
      // 只反馈当前手势，不在切屏或长时间等待后补播。
      if (active && id === request && Date.now() - at < 250 && engine.unlocked) {
        engine.play('uiClick', { gain: .65 });
      }
    }).catch(() => {});
  };
  const click = (event: MouseEvent): void => {
    const button = buttonFor(event);
    if (!button) return;
    if (event.detail === 0 && Date.now() - (keyboardAt.get(button) ?? -Infinity) < 500) return;
    play();
  };
  const keydown = (event: KeyboardEvent): void => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    const button = buttonFor(event);
    // 原生按钮由浏览器生成 click；自定义 role 按钮可能只在 keydown 执行动作。
    if (!button || button.matches('button, input')) return;
    keyboardAt.set(button, Date.now());
    play();
  };
  target.addEventListener('click', click, true);
  target.addEventListener('keydown', keydown, true);
  return () => {
    active = false;
    request += 1;
    target.removeEventListener('click', click, true);
    target.removeEventListener('keydown', keydown, true);
  };
}
