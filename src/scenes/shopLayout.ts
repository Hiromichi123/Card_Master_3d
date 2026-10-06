import { createRng, seedFrom } from '../domain/battle/rng';
import type { ChartSeries } from '../ui/LineChart';

/**
 * 两个商店的版面参数与「行情」数据。
 *
 * 数值全部来自旧版：常规商店 `scenes/shop_scene.py`、
 * 活动商店 `scenes/activity/activity_shop_scene.py`。单位是**设计单位**
 * （2880 × 1800 的设计空间，见 `DesignStage`）。
 */

export interface ShopText {
  readonly title: string;
  readonly subtitle: string;
}

export const SHOP_TEXT: Record<'normal' | 'activity', ShopText> = {
  normal: {
    title: '星辰商店',
    subtitle: '精选卡牌供货 / 卡包特典 / 市场行情一览',
  },
  activity: {
    title: '活动商店',
    subtitle: '使用活动徽章兑换限定奖励，库存每日刷新。',
  },
};

/**
 * 每排货架的卡片尺寸与排高（设计单位）。
 *
 * 高稀有度那排的卡更大——旧版就是这么分的（210×310 / 200×300 / 180×270）。
 * 活动商店的「活动精选」还额外有一套面板色与标签色。
 */
export interface ShelfMetric {
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly height: number;
  readonly panelColor?: string;
  readonly labelColor?: string;
}

export const SHELF_METRICS: Record<'normal' | 'activity', Record<string, ShelfMetric>> = {
  normal: {
    top: { cardWidth: 200, cardHeight: 300, height: 400 },
    middle: { cardWidth: 200, cardHeight: 300, height: 400 },
    bottom: { cardWidth: 160, cardHeight: 240, height: 380 },
  },
  activity: {
    top: {
      cardWidth: 210,
      cardHeight: 310,
      height: 420,
      // 活动精选那一排单独一套配色（旧版的 TOP_PANEL_COLOR / TOP_LABEL_COLOR）
      panelColor: 'rgba(70, 30, 80, 0.45)',
      labelColor: '#ffb4ff',
    },
    middle: { cardWidth: 200, cardHeight: 300, height: 410 },
    bottom: { cardWidth: 180, cardHeight: 270, height: 390 },
  },
};

/** 横轴标签：旧版写死了周一到周日。 */
export const WEEK_LABELS: readonly string[] = [
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
  '周日',
];

/** 行情三条线的颜色（旧版 `extra_series_colors`）。 */
const SERIES_COLORS: Record<string, string> = {
  '金币/水晶': '#ffd778',
  '金币/徽章': '#b4f0c8',
  '水晶/徽章': '#aad2ff',
  '徽章兑换': '#ffb4ff',
};
export function seriesColor(name: string): string {
  return SERIES_COLORS[name] ?? '#aad2ff';
}

/** 一次随机游走：以基准为中心 ±8% 抖动，七天。 */
function walk(rng: ReturnType<typeof createRng>, base: number, digits = 0): number[] {
  const values: number[] = [];
  let current = base;
  for (let day = 0; day < WEEK_LABELS.length; day += 1) {
    current += (rng.next() * 2 - 1) * base * 0.08;
    current = Math.max(base * 0.6, current);
    values.push(digits === 0 ? Math.round(current) : Number(current.toFixed(digits)));
  }
  return values;
}

/**
 * 行情数据。
 *
 * 旧版每次进场现 `random` 生成（`_generate_price_history` /
 * `_generate_exchange_history`），于是同一屏的图每次刷新都在跳。
 * 这里**按日键取种子**：同一天看到的是同一张图，换一天才换行情——
 * 与商店货架的「每日刷新」同一套口径。
 */
export function marketSeries(dayKey: string): {
  readonly price: readonly ChartSeries[];
  readonly exchange: readonly ChartSeries[];
} {
  const priceRng = createRng(seedFrom(`shop:price:${dayKey}`));
  const exchangeRng = createRng(seedFrom(`shop:exchange:${dayKey}`));

  return {
    price: [
      { name: 'SSS', color: seriesColor('水晶/徽章'), values: walk(priceRng, 551) },
      { name: 'SS', color: seriesColor('金币/水晶'), values: walk(priceRng, 324) },
      { name: 'A', color: seriesColor('金币/徽章'), values: walk(priceRng, 156) },
    ],
    exchange: [
      { name: '金币/水晶', color: seriesColor('金币/水晶'), values: walk(exchangeRng, 1034) },
      { name: '金币/徽章', color: seriesColor('金币/徽章'), values: walk(exchangeRng, 253) },
      { name: '水晶/徽章', color: seriesColor('水晶/徽章'), values: walk(exchangeRng, 37, 1) },
    ],
  };
}
