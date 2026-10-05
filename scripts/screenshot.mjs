#!/usr/bin/env node
/**
 * 开发期截图工具。
 *
 * 用途：把 3D 场景的实际渲染结果落成图片，便于人工核对与留档
 * （施工清单要求每阶段记录截图/录像，且「仅构建成功不能代表渲染正确」）。
 *
 * 用法：
 *   node scripts/screenshot.mjs <输出文件> [选项]
 *
 * 选项：
 *   --route <id>    先点击导航里的哪个页签（probe / battle / viewer）
 *   --width <px>    视口宽，默认 1920
 *   --height <px>   视口高，默认 1080
 *   --wait <ms>     截图前等待，默认 2500（等 WebGL 首帧与纹理）
 *   --url <url>     默认 http://127.0.0.1:5173
 *   --hover x,y     截图前把指针移到该屏幕坐标，用于验证悬停反馈
 *
 * 会把控制台错误一并打印出来；有错误时退出码为 1，
 * 避免「看起来有画面但其实在报错」被当成通过。
 */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { chromium } from 'playwright';

function parseArgs(argv) {
  const options = {
    out: null,
    route: null,
    width: 1920,
    height: 1080,
    wait: 2500,
    url: 'http://127.0.0.1:5173',
    hover: null,
  };

  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--route':
        options.route = argv[++i];
        break;
      case '--width':
        options.width = Number(argv[++i]);
        break;
      case '--height':
        options.height = Number(argv[++i]);
        break;
      case '--wait':
        options.wait = Number(argv[++i]);
        break;
      case '--hover': {
        const [x, y] = String(argv[++i]).split(',').map(Number);
        options.hover = [x, y];
        break;
      }
      case '--url':
        options.url = argv[++i];
        break;
      default:
        rest.push(arg);
    }
  }
  options.out = rest[0];
  return options;
}

const ROUTE_LABEL = {
  probe: '数据自检',
  battle: '战斗场景',
  viewer: '实验台',
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.out) {
    console.error('缺少输出文件路径。用法见文件头部注释。');
    process.exit(2);
  }

  const outPath = resolve(options.out);
  await mkdir(dirname(outPath), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
  });

  const problems = [];
  const warnings = [];
  page.on('console', (message) => {
    const type = message.type();
    if (type === 'error') {
      problems.push(`console: ${message.text()}`);
    } else if (type === 'warning') {
      // 警告也要收：资源加载失败在本项目里走的是 console.warn，
      // 只看 error 会漏掉「贴图没加载但页面没崩」这类问题。
      warnings.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) =>
    problems.push(`requestfailed: ${request.url()} (${request.failure()?.errorText ?? ''})`),
  );

  await page.goto(options.url, { waitUntil: 'load' });

  if (options.route) {
    const label = ROUTE_LABEL[options.route] ?? options.route;
    await page.getByRole('button', { name: label }).click();
  }

  await page.waitForTimeout(options.wait);

  if (options.hover) {
    // 悬停需要额外时间等阻尼动画收敛，否则拍到的还是抬起过程中的中间帧
    await page.mouse.move(options.hover[0], options.hover[1]);
    await page.waitForTimeout(700);
  }

  await page.screenshot({ path: outPath });
  await browser.close();

  console.log(`已保存 ${outPath}（${options.width}×${options.height}）`);
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} 条警告：`);
    for (const warning of warnings.slice(0, 20)) {
      console.log(`  - ${warning}`);
    }
  }
  if (problems.length > 0) {
    console.error(`\n发现 ${problems.length} 个前端问题：`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }
}

await main();
