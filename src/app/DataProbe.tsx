import { useMemo } from 'react';

import { SKILL_FAMILIES } from '../domain/skills/families';
import {
  cardById,
  cardDatabase,
  decks,
  incompleteCards,
  shops,
  slice,
  stages,
} from '../data';

/**
 * 数据自检面板。
 *
 * 作用是把「Python 生成的 JSON」到「应用读到的类型化数据」这条链路
 * 变成肉眼可验证的：数字对不上就说明导入或字段映射有问题。
 * P1 之后这个页面可以退役，但在此之前它是最便宜的端到端检查。
 */
export function DataProbe() {
  const stats = useMemo(() => {
    const definitions = cardDatabase.definitions;
    const complete = definitions.filter((card) => card.status === 'complete');
    const resolutions = new Map<string, number>();
    for (const card of definitions) {
      for (const skill of card.skills) {
        resolutions.set(skill.resolution, (resolutions.get(skill.resolution) ?? 0) + 1);
      }
    }
    return {
      total: definitions.length,
      complete: complete.length,
      incomplete: definitions.length - complete.length,
      resolutions: [...resolutions.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, []);

  const sampleCards = useMemo(
    () =>
      slice.cards
        .slice(0, 6)
        .map((entry) => cardById.get(entry.cardId))
        .filter((card) => card !== undefined),
    [],
  );

  const stageCount = stages.chapters.reduce((sum, c) => sum + c.stages.length, 0);

  return (
    <div className="probe">
      <h1>数据自检</h1>
      <p className="probe__lead">
        这些数字来自 <code>scripts/import-legacy-data.py</code> 生成的 JSON。
        预期：256 张卡（247 完整 + 9 未完成）、35 个技能族、12 关。
      </p>

      <section className="probe__grid">
        <Stat label="卡牌条目" value={stats.total} expect={256} />
        <Stat label="数据完整" value={stats.complete} expect={247} />
        <Stat label="数据不完整" value={stats.incomplete} expect={9} />
        <Stat label="技能族" value={SKILL_FAMILIES.length} expect={35} />
        <Stat label="关卡" value={stageCount} expect={12} />
        <Stat label="切片卡" value={slice.count} expect={23} />
        <Stat label="内容版本" value={cardDatabase.contentVersion} />
      </section>

      <section className="probe__section">
        <h2>trait 解析分布（按出现次数）</h2>
        <ul className="probe__list">
          {stats.resolutions.map(([name, count]) => (
            <li key={name}>
              <code>{name}</code>
              <span>{count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="probe__section">
        <h2>切片样本</h2>
        <table className="probe__table">
          <thead>
            <tr>
              <th>cardId</th>
              <th>名称</th>
              <th>ATK/HP/CD</th>
              <th>traits</th>
            </tr>
          </thead>
          <tbody>
            {sampleCards.map((card) => (
              <tr key={card.cardId}>
                <td>
                  <code>{card.cardId}</code>
                </td>
                {/* 旧数据里名称带空格（如「红 皇 后」），展示时去掉 */}
                <td>{card.name.replace(/ /g, '')}</td>
                <td>
                  {card.atk}/{card.hp}/{card.cd}
                </td>
                <td>{card.rawTraits.join('、') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="probe__section">
        <h2>其他</h2>
        <ul className="probe__list probe__list--plain">
          <li>
            <span>演示牌组</span>
            <span>
              {decks.demo ? `${decks.demo.cardIds.length} 张` : '缺失'} · 敌方牌组{' '}
              {Object.keys(decks.enemy).length} 套
            </span>
          </li>
          <li>
            <span>未完成卡（不进战斗与卡池）</span>
            <span>{incompleteCards.length} 张</span>
          </li>
          <li>
            <span>切片未覆盖的族</span>
            <span>{slice.familiesMissing.length} 个</span>
          </li>
          <li>
            <span>商店/融合已记录的旧版缺陷</span>
            <span>{shops.knownIssues.length} 条</span>
          </li>
          <li>
            <span>空章节</span>
            <span>{stages.emptyChapters.join('、') || '无'}</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, expect }: { label: string; value: string | number; expect?: number }) {
  const mismatch = expect !== undefined && value !== expect;
  return (
    <div className={mismatch ? 'probe__stat probe__stat--bad' : 'probe__stat'}>
      <span className="probe__stat-label">{label}</span>
      <span className="probe__stat-value">{value}</span>
      {expect !== undefined && (
        <span className="probe__stat-expect">期望 {expect}</span>
      )}
    </div>
  );
}
