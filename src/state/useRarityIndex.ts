import { rarityList } from '../data';
import { buildRarityIndex, type RarityIndex } from '../domain/progression/rarityIndex';

/**
 * 稀有度索引。
 *
 * 它只依赖静态的 `rarities.json`，所以**建一次就够了**，不必是 hook 里的 state。
 * 做成 hook 只是为了调用点读起来自然（`useRarityIndex()`），
 * 内部没有任何订阅或副作用。
 */
let cached: RarityIndex | null = null;

export function useRarityIndex(): RarityIndex {
  if (!cached) {
    cached = buildRarityIndex(rarityList);
  }
  return cached;
}

/** 非 React 场合（领域测试、事件处理）也能取到同一份。 */
export function rarityIndex(): RarityIndex {
  return useRarityIndex();
}
