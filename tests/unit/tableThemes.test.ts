import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME_ID, getTableTheme, TABLE_THEMES } from '../../src/rendering/table/themes';
import { hasWeather, TABLE_WEATHER } from '../../src/rendering/table/weather';

/**
 * 台面主题的数据断言。
 *
 * 「保留的台面互不相同」这件事放在这里而不是浏览器用例里：
 * 浏览器用例每换一套台面都要现生成 768² 的木纹并重编译着色器，
 * 多套主题在软件渲染下的切换耗时较长。数据层面的差异是快速且确定的，
 * 浏览器那边只留一组抽查验证渲染路径确实跟着主题走。
 */

describe('战斗台面主题', () => {
  it('八套可选台面，且 id 唯一', () => {
    expect(TABLE_THEMES.length).toBe(8);
    const ids = TABLE_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每套主题的浅格与深格颜色不同——否则棋盘格看不出来', () => {
    for (const theme of TABLE_THEMES) {
      expect(
        theme.mat.light.color,
        `${theme.id} 的浅格与深格同色，格子会消失`,
      ).not.toBe(theme.mat.dark.color);
    }
  });

  it('任意两套主题的配色都不相同', () => {
    const seen = new Map<string, string>();
    for (const theme of TABLE_THEMES) {
      const signature = [
        theme.mat.light.color,
        theme.mat.dark.color,
        theme.mat.frame.color,
        theme.background,
      ].join(':');
      const clash = seen.get(signature);
      expect(clash, `${theme.id} 与 ${clash} 的配色完全相同`).toBeUndefined();
      seen.set(signature, theme.id);
    }
  });

  it('每套主题都给了背景、雾与泛光参数', () => {
    for (const theme of TABLE_THEMES) {
      expect(typeof theme.background, theme.id).toBe('number');
      expect(theme.fog.far, `${theme.id} 的雾终点应当比起点远`).toBeGreaterThan(theme.fog.near);
      expect(theme.environmentIntensity, theme.id).toBeGreaterThan(0);
      expect(theme.post.bloom, theme.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('天气只挂在声明过的台面上，且不影响规则', () => {
    const weatherIds = Object.keys(TABLE_WEATHER);
    expect(weatherIds.length).toBeGreaterThanOrEqual(4);
    for (const id of weatherIds) {
      expect(
        TABLE_THEMES.some((theme) => theme.id === id),
        `天气 ${id} 没有对应的台面`,
      ).toBe(true);
    }
    // 没有天气的台面是静止的，这是刻意的（材质主题＝没有天气的同一场对局）
    expect(hasWeather('tournament')).toBe(false);
    expect(hasWeather('snow')).toBe(true);
  });

  it('找不到的 id 回退到默认主题，而不是抛错或返回 undefined', () => {
    expect(getTableTheme('不存在的台面').id).toBe(DEFAULT_THEME_ID);
  });
});
