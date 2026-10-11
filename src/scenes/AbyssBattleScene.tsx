import { useCallback, useEffect, useRef, useState } from 'react';
import type { BattleOutcome } from '../domain/battle/types';
import type { AbyssEncounter, AbyssRun } from '../domain/progression/abyssTypes';
import { abyssStateToken, planAbyssAction } from '../domain/progression/abyssRun';
import type { ProfileStore } from '../state/createProfileStore';
import { BattleScene } from './BattleScene';
import { compileAbyssBattle } from './abyssBattle';

/** 挂载期间冻结开场快照；保存战果不提前卸载正在播放的战斗。 */
export function AbyssBattleScene({ run, battle, store, onReturn }: {
  readonly run: AbyssRun;
  readonly battle: AbyssEncounter;
  readonly store: ProfileStore;
  readonly onReturn: () => void;
}) {
  const [compiled] = useState(() => compileAbyssBattle(run, battle));
  const [status, setStatus] = useState<'playing' | 'saving' | 'saved' | 'failed'>('playing');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  const result = useRef<BattleOutcome | null>(null);
  const saving = useRef(false);
  const saved = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const persist = useCallback(async () => {
    if (!result.current || saving.current || saved.current) return;
    saving.current = true;
    setStatus('saving'); setError('');
    const current = store.getSnapshot().profile;
    if (!current) { saving.current = false; setStatus('failed'); setError('存档尚未就绪'); return; }
    const action = { kind: 'settle' as const, expectedToken: abyssStateToken(current), battleId: battle.battleId, outcome: result.current };
    const response = await store.commitEconomic(profile => planAbyssAction(profile, action, Date.now()));
    saving.current = false;
    if (response.ok) saved.current = true;
    if (!alive.current) return;
    setStatus(response.ok ? 'saved' : 'failed');
    if (!response.ok) setError(response.message);
  }, [battle.battleId, store]);
  const finish = useCallback((value: BattleOutcome) => {
    if (result.current) return;
    result.current = value; setOutcome(value); void persist();
  }, [persist]);
  const leave = useCallback(() => {
    if (result.current && !saved.current) return;
    if (saved.current || window.confirm('离开后保留深渊进度；继续时会从同一敌人、同一增益的本战开场重新挑战。确定返回？')) onReturn();
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
  return <div className="abyss-battle">
    <BattleScene tableThemeId="abyss" config={compiled.config} definitions={compiled.definitions} autoStart allowRematch={false}
      onOutcome={finish} onLeave={leave} onExit={leave} leaveLabel="返回深渊" exitLabel="返回深渊"
      exitDisabled={status === 'saving' || status === 'failed'}
      resultPanel={<section className="abyss-battle__result" aria-label="深渊战果">
        <h2>{outcome?.kind === 'win' && outcome.winner === 'player' ? '胜利 · 营地已开启' : outcome?.kind === 'draw' ? '平局' : '挑战失败'}</h2>
        <p>{status === 'saving' ? '正在保存战果，请稍候…' : status === 'saved' ? '生命、深渊币与培养机会已保存。' : '战果尚未保存，不能离开或重打。'}</p>
        {error && <p role="alert">{error}</p>}
        {status === 'failed' && <button type="button" onClick={() => { void persist(); }}>重试保存</button>}
        <button type="button" disabled={status !== 'saved'} onClick={onReturn}>返回深渊</button>
      </section>} />
    <details className="abyss-battle__effects"><summary>本战特性 · {battle.floor}-{battle.encounter}</summary>
      <p>己方正面：{pair?.positive.description}</p><p>绑定负面：{pair?.negative.description}</p>
      <p>敌方：{battle.enemyEffect.description}</p><small>仅本战有效，包含召唤与复活单位，不写回培养牌库。</small>
    </details>
    {(status === 'saving' || status === 'failed') && <div className="abyss-battle__save" role="status">
      {status === 'saving' ? '保存战果中…' : <>{error}<button type="button" onClick={() => { void persist(); }}>重试保存</button></>}
    </div>}
  </div>;
}
