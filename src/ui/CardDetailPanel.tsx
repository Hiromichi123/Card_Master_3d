import type { CardDefinition } from '../domain/cards/types';

/**
 * 卡牌详情面板（`V-CARD-6` / `V-HUD-3`）。
 *
 * 为什么详情一定要走 DOM：中文名称、traits、长描述排版在 3D 里要么需要
 * troika 字体文件、要么为每张卡烘一堆文字 Mesh（`V-CARD-9` 明确否掉了后者）。
 * DOM 排版的清晰度和可访问性都更好，代价只是它必须正确遮挡指针事件。
 *
 * **事件遮挡**：面板是画布之上的 DOM 元素，点击天然到不了 canvas；
 * 这里再显式声明 `pointer-events: auto` 并停掉冒泡，避免以后有人给容器加了
 * `pointer-events: none` 之后点击穿透到场景、把选中状态清掉。
 */

export interface CardDetailPanelProps {
  readonly card: CardDefinition;
  /** 当前战斗中的数值。缺省用卡面定义里的初始值。 */
  readonly stats?: { readonly atk: number; readonly hp: number; readonly cd: number } | undefined;
  readonly pinned: boolean;
  readonly onClose: () => void;
  readonly onTogglePin: () => void;
}

/** 把 trait 的解析结论转成一句人话，供面板展示。 */
function describeTrait(resolution: string): string {
  switch (resolution) {
    case 'implemented':
      return '已实现';
    case 'scene-rule':
      return '场景规则';
    case 'alias':
      return '命名变体（未作为独立规则实现）';
    case 'flavor':
      return '说明性文字，无机制';
    case 'unimplemented':
      return '未实现';
    case 'ambiguous':
      return '待复核';
    default:
      return resolution;
  }
}

export function CardDetailPanel({
  card,
  stats,
  pinned,
  onClose,
  onTogglePin,
}: CardDetailPanelProps) {
  const atk = stats?.atk ?? card.atk;
  const hp = stats?.hp ?? card.hp;
  const cd = stats?.cd ?? card.cd;
  // 与初始值不同就标出来，让「被改动过」一眼可见
  const changed = {
    atk: atk !== card.atk,
    hp: hp !== card.hp,
    cd: cd !== card.cd,
  };

  return (
    <aside
      className="detail"
      // 显式声明：面板上的点击不穿透到 3D 场景
      style={{ pointerEvents: 'auto' }}
      onClick={(event) => event.stopPropagation()}
      role="complementary"
      aria-label="卡牌详情"
    >
      <header className="detail__head">
        <h2 className="detail__name">{card.name.replace(/ /g, '')}</h2>
        <div className="detail__actions">
          <button
            type="button"
            className={pinned ? 'detail__pin detail__pin--on' : 'detail__pin'}
            onClick={onTogglePin}
            title={pinned ? '取消固定' : '固定此卡（不随悬停切换）'}
          >
            {pinned ? '已固定' : '固定'}
          </button>
          <button type="button" className="detail__close" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
      </header>

      <div className="detail__meta">
        <code>{card.cardId}</code>
        <span className="detail__rarity">{card.rarity}</span>
        {card.status === 'incomplete' && (
          <span className="detail__warn">数据不完整，不进入战斗</span>
        )}
      </div>

      <dl className="detail__stats">
        <div className={changed.atk ? 'detail__stat detail__stat--changed' : 'detail__stat'}>
          <dt>ATK</dt>
          <dd>
            {atk}
            {changed.atk && <em>（初始 {card.atk}）</em>}
          </dd>
        </div>
        <div className={changed.hp ? 'detail__stat detail__stat--changed' : 'detail__stat'}>
          <dt>HP</dt>
          <dd>
            {hp}
            {changed.hp && <em>（初始 {card.hp}）</em>}
          </dd>
        </div>
        <div className={changed.cd ? 'detail__stat detail__stat--changed' : 'detail__stat'}>
          <dt>CD</dt>
          <dd>
            {cd}
            {changed.cd && <em>（初始 {card.cd}）</em>}
          </dd>
        </div>
      </dl>

      <section className="detail__section">
        <h3>技能</h3>
        {card.skills.length === 0 ? (
          <p className="detail__empty">这张卡没有技能。</p>
        ) : (
          <ul className="detail__traits">
            {card.skills.map((skill, index) => (
              <li key={`${skill.raw}-${index}`}>
                <span className="detail__trait-name">{skill.raw}</span>
                <span
                  className={`detail__trait-state detail__trait-state--${skill.resolution}`}
                >
                  {describeTrait(skill.resolution)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {card.description && (
        <section className="detail__section">
          <h3>描述</h3>
          <p className="detail__description">{card.description}</p>
        </section>
      )}
    </aside>
  );
}
