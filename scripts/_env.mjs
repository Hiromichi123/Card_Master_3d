import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=d3d11','--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message.slice(0,200)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0,200)); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load' });
await page.getByRole('button', { name: '战斗场景' }).click();
await page.waitForTimeout(6000);
const select = page.locator('.quality__select');
const clip = { x: 250, y: 220, width: 1420, height: 860 };
for (const id of ['tournament', 'snow', 'volcano', 'grass']) {
  await select.selectOption(id);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `D:/tmp/env-${id}.png`, clip });
}
console.log(errs.length ? '页面错误:\n' + errs.join('\n') : '无页面错误');
await browser.close();
