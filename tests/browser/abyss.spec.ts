import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/');
  await page.locator('.login-start').click({ timeout: 20000 });
  await page.locator('#login-username').fill('admin');
  await page.locator('#login-password').fill('admin');
  await page.locator('.login-form button[type="submit"]').click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/app-shell--locked/, { timeout: 20000 });
}

test('深渊主页入口、轮盘入口与海报同场景，黑幕不残留导航，返回正常恢复', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /深渊/ }).first().click();
  await expect(page.locator('.abyss-scene')).toBeVisible();
  await expect(page.locator('.hub-main')).toHaveCount(0);
  await expect(page.locator('.app-nav')).toHaveCount(0);
  await expect(page.locator('.abyss-scene')).toHaveAttribute('data-phase', 'active', { timeout: 15000 });
  await expect(page.locator('.abyss-scene__background')).toHaveAttribute('src', /activity_abyss_bg2\.webp/);
  await expect(page.locator('.abyss-scene__countdown')).toContainText('UTC+8');
  await expect(page.locator('.abyss-entrance')).toHaveCount(4);
  await expect(page.locator('.abyss-entrance[inert]')).toHaveCount(0);
  await expect(page.locator('.abyss-home-stage')).toHaveAttribute('data-layout', 'settled');
  await expect(page.locator('.abyss-vortex__cloud')).toHaveCount(4);
  await expect(page.locator('.abyss-vortex')).toHaveAttribute('data-motion', /running|still/);
  if (await page.locator('.abyss-vortex').getAttribute('data-motion') === 'running') {
    const cloud = page.locator('.abyss-vortex__cloud').first();
    const initialTransform = await cloud.evaluate(node => getComputedStyle(node).transform);
    await expect.poll(() => cloud.evaluate(node => getComputedStyle(node).transform)).not.toBe(initialTransform);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-nav')).toBeVisible();
  await page.locator('[data-wheel-id="abyss"]').click();
  await expect(page.locator('[data-wheel-id="abyss"]')).toContainText('NEW');
  const originalBackground = await page.locator('.menu--activity-abyss .menu__bg').first().getAttribute('style');
  await page.locator('.activity-detail__enter').click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-abyss-departing', /departing|darkening/);
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '');
  await expect(page.locator('.menu--activity-abyss .menu__bg').first()).toHaveAttribute('style', originalBackground!);
  await expect(page.locator('.abyss-scene')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.abyss-departure')).toHaveCount(0);
  await expect(page.locator('.activity-detail__enter')).toBeFocused();
  await page.locator('.activity-detail__enter').click();
  await expect(page.locator('.abyss-scene')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.abyss-scene__previous')).toHaveCount(0);
  await expect(page.locator('.abyss-scene')).toHaveAttribute('data-phase', 'active', { timeout: 15000 });
  await page.getByRole('button', { name: '主界面', exact: true }).click();
  await expect(page.locator('[data-testid="poster-carousel"]')).toHaveAttribute('data-poster-index', '0');
  await page.locator('[data-testid="poster-carousel"]').click();
  await expect(page.locator('.abyss-scene')).toBeVisible();
});

test('深渊起始选组、绑定契约、刷新继续和历史快照', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /深渊/ }).first().click();
  const start = page.getByRole('button', { name: /新的开始/ });
  await expect(start).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /继续进度/ })).toBeDisabled();
  await page.getByRole('button', { name: /已知特性/ }).click();
  await expect(page.getByRole('dialog', { name: '已知特性' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.abyss-scene')).toBeVisible();
  await start.click();
  await expect(page.locator('.abyss-preparation')).toHaveAttribute('data-stage', 'starterDraft');
  await expect(page.locator('.abyss-draft__choice')).toHaveCount(3);
  await expect(page.locator('.abyss-draft__cards img')).toHaveCount(18);
  await expect(page.locator('.abyss-preparation canvas')).toHaveCount(1);
  await expect(page.locator('.abyss-scene__world')).toHaveCount(0);
  const first = await page.locator('.abyss-draft__choice').first().locator('img').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')));
  // 重新登录回主界面，再进入深渊，不应重抽起始组。
  await login(page);
  await page.getByRole('button', { name: /深渊/ }).first().click();
  await page.getByRole('button', { name: /继续进度/ }).click({ timeout: 15000 });
  expect(await page.locator('.abyss-draft__choice').first().locator('img').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')))).toEqual(first);
  await page.getByRole('button', { name: '卡组1', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.locator('.abyss-boon')).toHaveCount(3);
  await page.locator('.abyss-boon').first().click();
  await expect(page.locator('.abyss-run')).toHaveAttribute('data-stage', 'battleReady');
  await expect(page.locator('.abyss-run__deck')).toHaveCount(0);
  await expect(page.locator('.abyss-collect')).toHaveCount(0);
  await page.getByRole('button', { name: '返回深渊大厅', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await start.click();
  await page.getByRole('button', { name: '返回深渊大厅', exact: true }).click();
  await page.getByRole('button', { name: /游玩历史/ }).click();
  const history = page.getByRole('dialog', { name: '游玩历史' });
  await expect(history).toContainText('放弃挑战');
  await history.locator('summary').first().click();
  await expect(history.locator('.abyss-card')).toHaveCount(6);
});

test('系统减弱动态不禁用深渊，背景失败仍可返回', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.getByRole('button', { name: /深渊/ }).first().click();
  await expect(page.locator('.abyss-scene')).toHaveAttribute('data-still', 'false');
  await expect(page.locator('.abyss-scene')).toHaveAttribute('data-phase', 'active', { timeout: 15000 });
  await expect(page.locator('.abyss-vortex')).toHaveAttribute('data-motion', 'running');
  await expect(page.locator('.abyss-vortex__spark')).toHaveCount(36);
  await expect(page.locator('.abyss-vortex__sparks')).toBeVisible();
  await expect(page.locator('.abyss-vortex__spark-orbit')).toHaveCSS('animation-play-state', 'running');
  const cloud = page.locator('.abyss-vortex__cloud').first();
  const transform = await cloud.evaluate(node => getComputedStyle(node).transform);
  await expect.poll(() => cloud.evaluate(node => getComputedStyle(node).transform)).not.toBe(transform);
  await expect(page.locator('.abyss-entrance')).toHaveCount(4);
  await expect(page.locator('.abyss-entrance').last()).toHaveCSS('--abyss-enter-delay', '480ms');
  await page.getByRole('button', { name: '返回活动', exact: true }).click();
  await page.route('**/activity_abyss_bg2.webp', route => route.abort());
  await page.locator('[data-wheel-id="abyss"]').click();
  await page.locator('.activity-detail__enter').click();
  await expect(page.locator('.abyss-scene__error')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '返回活动', exact: true }).click();
  await expect(page.locator('.app-nav')).toBeVisible();
});
