import { useCallback, useEffect, useRef, useState } from 'react';
import type { BattleOutcome } from '../domain/battle/types';
import type { AbyssEncounter, AbyssRun } from '../domain/progression/abyssTypes';
import { abyssStateToken, planAbyssAction } from '../domain/progression/abyssRun';
import type { ProfileStore } from '../state/createProfileStore';
import { AbyssTraitCards } from '../ui/AbyssTraitCards';
import { abyssEffectGrade, abyssEffectLevel } from '../domain/progression/abyssGrades';
import { BattleScene } from './BattleScene';
import { compileAbyssBattle } from './abyssBattle';
import { useForegroundTimeout } from '../ui/useForegroundTimeout';
import { useSharedBattleSurface } from '../rendering/battle/SharedBattleSurfaceContext';

/** Keep the battle immutable through its final animation, then clear the table for settlement. */
export function AbyssBattleScene({ run, battle, store: _store, onReturn, onRules }: {
  readonly run: AbyssRun; readonly battle: AbyssEncounter; readonly store: ProfileStore;
  readonly onReturn: (outcome?: BattleOutcome) => void;
  readonly onRules?: (() => void) | undefined;
}) {
  const sharedSurface = useSharedBattleSurface();
  const [departing, setDeparting] = useState<BattleOutcome | null>(null);
  const [compiled] = useState(() => compileAbyssBattle(run, battle));
  const result = useRef<BattleOutcome | null>(null), returned = useRef(false);
  const finish = useCallback((value: BattleOutcome) => { if (!result.current) result.current = value; }, []);
  const returnForSettlement = useCallback((value: BattleOutcome) => {
    if (returned.current) return;
    returned.current = true;
    setDeparting(result.current ?? value);
  }, [onReturn]);
  useForegroundTimeout(!!departing, 450, () => { if (departing) onReturn(departing); });
  const leave = useCallback(() => {
    if (result.current) return; // The completed animation owns the handoff.
    if (window.confirm('离开后保留深渊进度；继续时从同一敌人、同一契约的本战开场重新挑战。确定返回？')) onReturn();
  }, [onReturn]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); leave();
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [leave]);
  const pair = battle.boonChoices[battle.selectedBoon ?? -1];
  const [effectsOpen, setEffectsOpen] = useState(false);
  return <div className="abyss-battle" data-shared={!!sharedSurface} data-ending={!!departing}>
    {onRules && <button className="abyss-battle__rules" type="button" onClick={onRules}>规则讲解</button>}
    <BattleScene clearing={!!departing} tableThemeId="abyss" config={compiled.config} definitions={compiled.definitions} autoStart allowRematch={false}
      onOutcome={finish} onFinished={returnForSettlement} onLeave={leave} onExit={leave}
      leaveLabel="返回深渊" exitLabel="返回深渊"
      resultPanel={<section className="abyss-battle__result" aria-label="深渊战果">
        <h2>清空盘面并结算…</h2>
        <button type="button" onClick={() => { if (result.current) returnForSettlement(result.current); }}>前往奖励盘面</button>
      </section>} />
    <details className="abyss-battle__effects" onToggle={event => setEffectsOpen(event.currentTarget.open)}>
      <summary>本战特性 · {battle.floor}-{battle.encounter}</summary>
      {effectsOpen && <AbyssTraitCards items={[
        ...(pair ? [pair.positive, pair.negative] : []), battle.enemyEffect,
      ].map((effect, index) => ({ id: `${index}:${effect.id}`, name: effect.name,
        description: effect.description, tone: effect.polarity, icon: effect.modifier.traits[0]?.family ?? effect.id.split('-')[0]!, grade: abyssEffectGrade(effect), level: abyssEffectLevel(effect),
        footer: index === 2 ? '敌方全体 · 本战有效' : '己方全体 · 本战有效' }))} />}
    </details>
  </div>;
}

/** Mounted over a cleared reward table after the final battle animation. */
export function AbyssSettlement({ store, battleId, outcome, onSaved }: {
  readonly store: ProfileStore; readonly battleId: string; readonly outcome: BattleOutcome; readonly onSaved: () => void;
}) {
  const [status, setStatus] = useState<'waiting' | 'saving' | 'failed'>('waiting');
  const [error, setError] = useState('');
  const saving = useRef(false), saved = useRef(false), alive = useRef(true);
  const latestSaved = useRef(onSaved); latestSaved.current = onSaved;
  const persist = useCallback(async () => {
    if (saving.current || saved.current) return;
    const current = store.getSnapshot().profile;
    if (!current) { setStatus('failed'); setError('存档尚未就绪'); return; }
    // If already persisted during a prior mount, do not grant the reward again.
    if (current.abyss.run?.lastSettledBattleId === battleId
      || current.abyss.history.some(entry => `${entry.runId}/battle/${entry.floor}/${entry.encounter}` === battleId)) {
      saved.current = true; latestSaved.current(); return;
    }
    saving.current = true; setStatus('saving'); setError('');
    const action = { kind: 'settle' as const, expectedToken: abyssStateToken(current), battleId, outcome };
    const response = await store.commitEconomic(profile => planAbyssAction(profile, action, Date.now()));
    saving.current = false;
    if (response.ok) saved.current = true;
    if (!alive.current) return;
    if (response.ok) latestSaved.current();
    else { setStatus('failed'); setError(response.message); }
  }, [store, battleId, outcome]);
  useEffect(() => {
    alive.current = true;
    let second = 0;
    // Paint the cleared table first, including in reduced-motion mode.
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { void persist(); }); });
    return () => { alive.current = false; cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [persist]);
  return <section className="abyss-settlement" aria-label="盘面战果结算" aria-busy={status !== 'failed'}>
    <small>第 {battleId.split('/').slice(-2).join('-')} 战 · 深渊盘面</small>
    <h1>{outcome.kind === 'win' && outcome.winner === 'player' ? '胜利' : outcome.kind === 'draw' ? '平局' : '挑战失利'}</h1>
    <p role="status">{status === 'waiting' ? '正在清理盘面…' : status === 'saving' ? '结算深渊币与本局奖励…' : '战果未保存，请重试'}</p>
    {error && <p role="alert">{error}</p>}
    {status === 'failed' && <button type="button" onClick={() => { void persist(); }}>重试结算</button>}
  </section>;
}
