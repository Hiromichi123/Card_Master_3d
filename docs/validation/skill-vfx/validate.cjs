const projectRoot = require('node:path').resolve(__dirname, '../../..');
const { chromium } = require(require('node:path').join(projectRoot, 'node_modules/playwright'));
const previewUrl = process.env.VFX_BASE_URL || 'http://127.0.0.1:5173/';
const fs = require('node:fs');
const path = require('node:path');

let browser;
(async () => {
  const output = __dirname;
  fs.mkdirSync(output, { recursive: true });
  browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.goto(previewUrl);
  await page.waitForTimeout(800);
  console.log('PAGE', (await page.locator('body').innerText()).slice(0, 1200));
  console.log('ERRORS', JSON.stringify(errors));
  await page.screenshot({ path: path.join(output, 'initial.png') });
  await page.getByRole('button', { name: /实验台/ }).first().click();
  await page.getByRole('heading', { name: '实验台' }).waitFor();
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(1000);
  const gpu = await page.locator('canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'unavailable';
  });
  const pause = page.getByLabel('暂停（冻结粒子与时间轴，相机仍可操作）');
  const clear = page.getByRole('button', { name: '立即结束全部特效（跳过）' });
  const cases = [
    ['fireball', '火球', 260], ['ice', '冰封', 540], ['lightning', '闪电', 180],
    ['group-heal', '群体治愈', 470], ['armor-break', '破甲', 370],
    ['drain', '吸血流光', 280], ['revive', '还魂 / 复活', 420],
  ];
  for (const [id, label, delay] of cases) {
    await pause.uncheck();
    await clear.click();
    // Warm the new shader/texture, then capture a repeat at a deterministic phase.
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(1100);
    await clear.click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(delay);
    await pause.check();
    await page.screenshot({ path: path.join(output, `${id}.png`) });
    console.log(`Captured ${id}`);
  }
  await pause.uncheck();
  await clear.click();
  await page.waitForTimeout(250);
  const labels = ['普通攻击', '火球', '冰封', '闪电', '群体火球', '群体冰封', '群体闪电', '护盾 / 防御', '治愈 / 恢复', '祝福 / 振奋', '诅咒 / 受伤', '抽卡 / 转移', '飞行提示', '炮击', '死亡爆裂 / 自毁', '群体治愈', '破甲', '闪避残影', '吸血流光', '还魂 / 复活', '分身 / 复制', '加速 / 延迟', '沉默封印'];
  for (const quality of ['低', '高']) {
    await page.getByText(quality, { exact: true }).first().click();
    for (const label of labels) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(180);
      await clear.click();
    }
    console.log(`All ${labels.length} templates verified at ${quality} quality`);
  }
  await page.waitForTimeout(300);
  const particleText = await page.locator('.lab__meta').last().innerText();
  if (!/活跃粒子\s*0\s*\//.test(particleText)) throw new Error('Particles not cleared: ' + particleText);
  fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ gpu, errors, particleText, screenshots: cases.map(c => `${c[0]}.png`) }, null, 2));
  console.log(JSON.stringify({ gpu, errors, particleText }));
  const battleResults = [];
  for (const speed of ['快速', '跳过']) {
    await page.goto(previewUrl);
    await page.getByRole('button', { name: /^演示战斗/ }).click();
    await page.getByText(speed, { exact: true }).first().click();
    await page.getByLabel(/自动演示/).check();
    await page.getByRole('button', { name: '开始对局' }).click();
    await page.locator('.overlay__title').waitFor({ timeout: 240000 });
    const result = { speed, verdict: await page.locator('.overlay__title').innerText(), score: await page.locator('.overlay__score').innerText(), reason: await page.locator('.overlay__reason').innerText() };
    battleResults.push(result);
    console.log('BATTLE', JSON.stringify(result));
  }
  const [fast, skipped] = battleResults;
  if (fast.verdict !== skipped.verdict || fast.score !== skipped.score || fast.reason !== skipped.reason) throw new Error('Fast and skipped browser battle results differ');
  fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ gpu, errors, particleText, screenshots: cases.map(c => `${c[0]}.png`), templateChecks: { templates: labels.length, qualities: ['low', 'high'] }, battleResults }, null, 2));
  await browser.close();
  if (errors.length) process.exitCode = 1;
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
