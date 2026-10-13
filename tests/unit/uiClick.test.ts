// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachUiClickSound } from '../../src/services/audio/uiClick';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function setup(markup: string, unlocked = true) {
  document.body.innerHTML = markup;
  const engine = { unlocked, resume: vi.fn(async () => {}), play: vi.fn() };
  const remove = attachUiClickSound(document, engine);
  cleanups.push(remove);
  return { engine, remove };
}
function click(selector: string, detail = 1) {
  document.querySelector(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
}
function key(selector: string, value: string, repeat = false) {
  document.querySelector(selector)!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value, repeat }));
}

describe('统一按钮点击音效', () => {
  it('按钮子图标和 portal 区域可触发，不受冒泡阻断影响', () => {
    const { engine } = setup('<button><span>图标</span></button><aside><button id="portal">领取</button></aside>');
    document.querySelector('span')!.addEventListener('click', event => event.stopPropagation());
    click('span');
    click('#portal');
    expect(engine.play).toHaveBeenCalledTimes(2);
    expect(engine.play).toHaveBeenCalledWith('uiClick', { gain: .65 });
  });
  it('禁用、aria-disabled、inert、背景和输入文字不响', () => {
    const { engine } = setup('<button disabled id="a"></button><fieldset disabled><button id="b"></button></fieldset><div aria-disabled="true"><button id="c"></button></div><div inert><button id="d"></button></div><p></p><input>');
    for (const selector of ['#a', '#b', '#c', '#d', 'p', 'input']) click(selector);
    key('input', 'Enter');
    expect(engine.play).not.toHaveBeenCalled();
  });
  it('原生键盘按钮只在 click 响，自定义 role 按钮去重且忽略 repeat', () => {
    const { engine } = setup('<button></button><div role="button" tabindex="0"></div>');
    key('button', 'Enter');
    expect(engine.play).not.toHaveBeenCalled();
    click('button', 0);
    key('div', ' ');
    key('div', ' ', true);
    click('div', 0);
    expect(engine.play).toHaveBeenCalledTimes(2);
    click('div', 1);
    expect(engine.play).toHaveBeenCalledTimes(3);
  });
  it('清理再安装没有重复监听', () => {
    const { engine, remove } = setup('<button></button>');
    remove();
    cleanups.push(attachUiClickSound(document, engine));
    click('button');
    expect(engine.play).toHaveBeenCalledTimes(1);
    cleanups.at(-1)!();
    click('button');
    expect(engine.play).toHaveBeenCalledTimes(1);
  });
  it('首次解锁成功响一次，失败静默', async () => {
    const { engine } = setup('<button></button>', false);
    engine.resume.mockImplementation(async () => { engine.unlocked = true; });
    click('button');
    await Promise.resolve();
    expect(engine.play).toHaveBeenCalledTimes(1);
    engine.unlocked = false;
    engine.resume.mockRejectedValue(new Error('blocked'));
    click('button');
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.play).toHaveBeenCalledTimes(1);
  });
  it('卸载或超过250ms的迟到解锁不补播', async () => {
    const { engine, remove } = setup('<button></button>', false);
    let finish!: () => void;
    engine.resume.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    click('button');
    remove();
    engine.unlocked = true;
    finish();
    await Promise.resolve();
    expect(engine.play).not.toHaveBeenCalled();
    engine.unlocked = false;
    cleanups.push(attachUiClickSound(document, engine));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    click('button');
    clock.mockReturnValue(1300);
    engine.unlocked = true;
    finish();
    await Promise.resolve();
    expect(engine.play).not.toHaveBeenCalled();
  });
});
