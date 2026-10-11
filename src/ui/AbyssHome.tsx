import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AbyssRun } from '../domain/progression/abyssTypes';
import { ABYSS_HOME_SETTLE_WAIT_MS, ABYSS_HOME_SHIFT_MS } from '../scenes/abyssPresentation';
import { AbyssCountdown } from './AbyssCountdown';
import { AbyssEntrance } from './AbyssEntrance';
import { useForegroundTimeout } from './useForegroundTimeout';
import './abyssHome.css';

type HomeLayout = 'waiting' | 'moving' | 'settled';

/** 放在父场景里，离开盘面再返回时不重新播放大厅入场。 */
export function useAbyssHomePresentation(still: boolean, shown: boolean) {
  const [arrivedMask, setArrivedMask] = useState(0);
  const [layout, setLayout] = useState<HomeLayout>('waiting');
  const entered = useRef(false);
  useEffect(() => {
    if (shown) entered.current = true;
    else if (entered.current) {
      setArrivedMask(15);
      setLayout('settled');
    }
  }, [shown]);
  const onArrived = useCallback((index: number) => {
    setArrivedMask(mask => mask | (1 << index));
  }, []);
  useForegroundTimeout(shown && arrivedMask === 15 && layout === 'waiting', ABYSS_HOME_SETTLE_WAIT_MS,
    () => setLayout(still ? 'settled' : 'moving'));
  useForegroundTimeout(shown && layout === 'moving', ABYSS_HOME_SHIFT_MS, () => setLayout('settled'));
  useEffect(() => { if (still && layout === 'moving') setLayout('settled'); }, [still, layout]);
  return { arrivedMask, layout, onArrived };
}

export function AbyssHome({ presentation, still, busy, available, run, onStart, onContinue, onTraits, onHistory }: {
  readonly presentation: ReturnType<typeof useAbyssHomePresentation>;
  readonly still: boolean;
  readonly busy: boolean;
  readonly available: boolean;
  readonly run: AbyssRun | null;
  readonly onStart: () => void;
  readonly onContinue: () => void;
  readonly onTraits: () => void;
  readonly onHistory: () => void;
}) {
  const { arrivedMask, layout, onArrived } = presentation;
  const entries = [
    { title: '新的开始', detail: '从三套六张起始牌组中选择', disabled: busy || !available, action: onStart },
    { title: '继续进度', detail: run ? `${run.floor}-${run.encounter} · ${run.lives}颗心 · ${run.coins}币` : '暂无进行中的挑战', disabled: busy || !run, action: onContinue },
    { title: '已知特性', detail: '正负契约与培养规则', disabled: !available, action: onTraits },
    { title: '游玩历史', detail: '最近10次挑战与最终卡组', disabled: !available, action: onHistory },
  ];
  return <div className="abyss-home-stage" data-layout={layout} data-still={still}
    style={{ '--abyss-home-shift-ms': `${ABYSS_HOME_SHIFT_MS}ms` } as CSSProperties}>
    <div className="abyss-scene__countdown abyss-home-stage__countdown"><AbyssCountdown /></div>
    <h1 className="abyss-home-stage__title">深 渊</h1>
    <section className="abyss-home" aria-label="深渊大厅">
      <p className="abyss-home__eyebrow">THE ABYSS · 独立肉鸽挑战</p>
      <div className="abyss-home-stage__title-space" aria-hidden="true" />
      <p>三颗心，一副只属于这次旅途的卡组。</p>
      <div className="abyss-home__buttons">
        {entries.map((entry, index) => <AbyssEntrance key={entry.title} index={index} play={(arrivedMask & (1 << index)) === 0} still={still} onArrived={onArrived}>
          <button type="button" disabled={entry.disabled} onClick={entry.action}><strong>{entry.title}</strong><small>{entry.detail}</small></button>
        </AbyssEntrance>)}
      </div>
      <p className="abyss-note">每周到点不清进度 · 深渊币仅本轮有效 · 同账号请只在一个页面游玩</p>
    </section>
  </div>;
}
