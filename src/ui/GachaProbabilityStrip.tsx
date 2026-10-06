import { formatPercent } from '../domain/progression/gacha';
import { useRarityIndex } from '../state/useRarityIndex';

/** Shared compact bottom row, matching the original rarity(percent) presentation. */
export function GachaProbabilityStrip({ rows, rare }: {
  readonly rows: readonly { readonly rarity: string; readonly percent: number }[];
  readonly rare: number;
}) {
  const rarityIndex = useRarityIndex();
  return (
    <div className="gacha-probability" aria-label="卡池概率分布">
      <span className="gacha__rare">稀有及以上 {formatPercent(rare)}</span>
      <ul className="gacha-probability__rows">
        {rows.map((row) => <li key={row.rarity} style={{ color: rarityIndex.colorOf(row.rarity) }}>
          {row.rarity}(<span className="gacha__prob-value">{formatPercent(row.percent)}</span>)
        </li>)}
      </ul>
    </div>
  );
}
