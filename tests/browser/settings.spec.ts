import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { collectProblems, expectPersisted, openWithFreshSave, readProfile } from './helpers';

/**
 * 设置屏：可达性、设置的持久化、存档导入导出。
 *
 * **数值断言一律读 IndexedDB**（`readProfile` / `expectPersisted`），不读界面文本——
 * 「界面显示了什么」与「真的存下来了」是两回事，这里要证的是后者。
 */

async function enterSettings(page: Page): Promise<void> {
  // 限定在入口区：导航栏里也有同名按钮
  await page.locator('.menu__columns').getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('.settings__grid')).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  await openWithFreshSave(page);
  await expect(page.locator('.menu__title')).toHaveText('Card Master 3D', { timeout: 30_000 });
  await enterSettings(page);
}

/**
 * range 输入用不了 `fill`。
 *
 * **必须走原生 setter**：React 给受控 input 的 `value` 装了自己的跟踪器，
 * 直接 `input.value = x` 会让跟踪器也认为「没变」，于是 onChange 不触发。
 * 从原型上取原生 setter 调用，再派发 input 事件，React 才认这次改动。
 */
async function setRange(page: Page, label: string, value: string): Promise<void> {
  await page.getByLabel(label).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('主菜单「设置」进的是真屏（不再是占位）', async ({ page }) => {
  const problems = collectProblems(page);
  await openSettings(page);

  await expect(page.locator('.screen__title')).toHaveText('设置');
  await expect(page.locator('.settings__panel').first()).toBeVisible();

  expect(problems).toEqual([]);
});

test('画质档改完会写进存档，刷新后仍在', async ({ page }) => {
  const problems = collectProblems(page);
  await openSettings(page);

  await page.getByRole('button', { name: '低', exact: true }).click();
  await expectPersisted(page, (profile) => profile.settings.quality, 'low');
  // 选预设 = 四个参数一起写回
  await expectPersisted(page, (profile) => profile.settings.dprCap, 1);
  await expectPersisted(page, (profile) => profile.settings.bloom, false);

  await page.reload();
  // 刷新后路由回到主菜单，重新进设置
  await expect(page.locator('.menu__title')).toHaveText('Card Master 3D', { timeout: 30_000 });
  await enterSettings(page);
  // 界面读到的还是「低」档
  await expect(page.locator('.settings__seg--on').first()).toHaveText('低');

  expect(problems).toEqual([]);
});

test('主音量改完会写进存档', async ({ page }) => {
  const problems = collectProblems(page);
  await openSettings(page);

  await setRange(page, '主音量', '40');
  await expectPersisted(page, (profile) => profile.settings.masterVolume, 0.4);

  expect(problems).toEqual([]);
});

test('高级里的单项覆盖：改 DPR 之后判为自定义', async ({ page }) => {
  const problems = collectProblems(page);
  await openSettings(page);

  await page.getByRole('button', { name: /高级/ }).click();
  await setRange(page, 'DPR 上限', '1.25');

  await expectPersisted(page, (profile) => profile.settings.dprCap, 1.25);
  // 与任何预设都不相等
  await expect(page.getByText('自定义')).toBeVisible();

  expect(problems).toEqual([]);
});

test('导出存档：文件名带日键与修订号，内容就是盘上那一份', async ({ page }) => {
  const problems = collectProblems(page);
  await openSettings(page);

  // 先做一次真实改动，保证盘上有记录
  await page.getByRole('button', { name: '低', exact: true }).click();
  await expectPersisted(page, (profile) => profile.settings.quality, 'low');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出 JSON' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^card-master-3d-\d{8}-v1-r\d+\.json$/);

  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, 'utf8'));
  // 导出取的是完整 ProfileState，且是已落盘的那一份
  expect(exported).toEqual(await readProfile(page));

  expect(problems).toEqual([]);
});

test('导入非法 JSON：报错且存档不变', async ({ page }) => {
  const problems = collectProblems(page);
  await openSettings(page);

  await page.getByRole('button', { name: '低', exact: true }).click();
  await expectPersisted(page, (profile) => profile.settings.quality, 'low');
  const before = JSON.stringify(await readProfile(page));

  await page.locator('input[type="file"]').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ oops', 'utf8'),
  });

  // 解析失败在预览弹窗里给出可读原因（不是静默失败）
  const dialog = page.getByRole('dialog', { name: '无法导入' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('JSON');
  expect(JSON.stringify(await readProfile(page))).toBe(before);
  // 区分「记录没变」与「记录被删了」
  expect(await readProfile(page)).not.toBeUndefined();

  expect(problems).toEqual([]);
});

test('导入版本过高的存档：拒绝，且文案报出两个版本号', async ({ page }) => {
  const problems = collectProblems(page);
  await openSettings(page);

  await page.getByRole('button', { name: '低', exact: true }).click();
  await expectPersisted(page, (profile) => profile.settings.quality, 'low');
  const before = await readProfile(page);

  await page.locator('input[type="file"]').setInputFiles({
    name: 'future.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ schemaVersion: 99, inventory: {}, currencies: {}, settings: {} }),
      'utf8',
    ),
  });

  const dialog = page.getByRole('dialog', { name: '无法导入' });
  await expect(dialog).toBeVisible();
  // 文案必须同时报出两个版本号，玩家才知道该用哪个客户端打开
  await expect(dialog).toContainText('v99');
  await expect(dialog).toContainText('v1');
  expect(JSON.stringify(await readProfile(page))).toBe(JSON.stringify(before));

  expect(problems).toEqual([]);
});

test('导入旧版存档：预览列出未知项，确认前不动存档', async ({ page }) => {
  const problems = collectProblems(page);
  await openSettings(page);

  await page.getByRole('button', { name: '低', exact: true }).click();
  await expectPersisted(page, (profile) => profile.settings.quality, 'low');
  const baseline = await readProfile(page);
  const before = JSON.stringify(baseline);

  // 卡库里的真实一张卡（`SSS_001` → 旧路径 `assets/outputs/SSS/001.png`），
  // 再造一条认不出来的路径
  const cardId = 'SSS_001';
  const ownedBefore = baseline?.inventory[cardId] ?? 0;
  const legacy = JSON.stringify({
    cards: [
      { path: 'assets/outputs/SSS/001.png' },
      { path: 'weird/thing.png' },
    ],
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: 'inventory.json',
    mimeType: 'application/json',
    buffer: Buffer.from(legacy, 'utf8'),
  });

  const dialog = page.getByRole('dialog', { name: '导入预览' });
  await expect(dialog).toBeVisible();
  // 未知项可见，且带原因
  await expect(dialog.locator('.settings__list--unknown')).toContainText('weird/thing.png');
  await expect(dialog.locator('.settings__list--unknown')).toContainText('路径形状不认识');
  // 预览本身不改动任何东西
  expect(JSON.stringify(await readProfile(page))).toBe(before);

  await dialog.getByRole('button', { name: '确认导入' }).click();
  await expect(dialog).toBeHidden();
  await expectPersisted(page, (profile) => profile.inventory[cardId] ?? 0, ownedBefore + 1);

  expect(problems).toEqual([]);
});

test('试听：点一下不会报错（AudioContext 惰性创建 + 手势解锁这条路是通的）', async ({ page }) => {
  const problems = collectProblems(page);
  await openSettings(page);

  // 这一下点击本身就是手势：App 的解锁监听挂在捕获阶段，先于它拿到
  await page.getByRole('button', { name: '试听' }).click();

  // 打开音频后不该有 console error / pageerror
  await expect(page.locator('.settings__panel').first()).toBeVisible();
  expect(problems).toEqual([]);
});
