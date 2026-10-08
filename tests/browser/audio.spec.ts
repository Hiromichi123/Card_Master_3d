import { expect, test, type Page } from '@playwright/test';

import { openWithFreshSave } from './helpers';

/**
 * 音效：**响度**与「真的排过声部」。
 *
 * 存在这条用例的原因是一次真实事故（2026-10-08）：音频链路本身是通的
 * （context `running`、`play()` 也真的排了节点），但各类音效的峰值只有
 * −20 ~ −25 dBFS，乘上 0.7 的主音量后落到 −26 ~ −31 dB，笔记本喇叭上听不见。
 * 靠耳朵调不出这件事，所以这里**离线渲染量峰值**，把它钉在用例里。
 *
 * 峰值走 `OfflineAudioContext` 渲染与线上**同一套**合成图（`scheduleCue`），
 * 因此断言的是真实响度，不是某个常量的复述。
 */

async function openSettings(page: Page): Promise<void> {
  await openWithFreshSave(page);
  await expect(page.locator('.menu__title')).toHaveText('Card Master 3D', { timeout: 30_000 });
  await page.locator('.menu__columns').getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('.settings__grid')).toBeVisible();
}

interface AudioProbe {
  readonly stats: { readonly played: number; readonly requested: number };
  readonly state: string | null;
  readonly peaks: Record<string, number | null>;
}

async function probe(page: Page): Promise<AudioProbe | null> {
  return page.evaluate(async () => {
    const engine = (
      window as unknown as {
        __cmAudio?: {
          stats: { played: number; requested: number };
          state: string | null;
          measurePeak: (cue: string) => Promise<number | null>;
        };
      }
    ).__cmAudio;
    if (!engine) {
      return null;
    }
    const peaks: Record<string, number | null> = {};
    for (const cue of ['deal', 'hit', 'death', 'gacha', 'fusion']) {
      peaks[cue] = await engine.measurePeak(cue);
    }
    return { stats: engine.stats, state: engine.state, peaks };
  });
}

test('试听会真的排声部，且音频上下文处于 running', async ({ page }) => {
  await openSettings(page);
  await page.getByRole('button', { name: '试听' }).click();
  await page.waitForTimeout(200);

  const result = await probe(page);
  expect(result).not.toBeNull();
  expect(result!.state).toBe('running');
  expect(result!.stats.played).toBeGreaterThan(0);
});

test('五类音效的实测峰值都落在可听区间', async ({ page }) => {
  await openSettings(page);
  // 先点一下解锁上下文（measurePeak 走离线渲染，不依赖它，但保持贴近真实路径）
  await page.getByRole('button', { name: '试听' }).click();

  const result = await probe(page);
  expect(result).not.toBeNull();

  for (const [cue, peak] of Object.entries(result!.peaks)) {
    expect(peak, `${cue} 没能离线渲染`).not.toBeNull();
    // 下限：低于 0.3 就会在笔记本喇叭上被淹没；上限：留出「同时几十声」的余量
    expect(peak!, `${cue} 峰值 ${peak!.toFixed(3)} 偏低，会听不见`).toBeGreaterThan(0.3);
    expect(peak!, `${cue} 峰值 ${peak!.toFixed(3)} 偏高，多声叠加会削顶`).toBeLessThan(0.85);
  }
});
