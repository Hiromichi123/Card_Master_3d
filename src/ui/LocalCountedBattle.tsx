import { useRef, useState } from 'react';
import type { BattleConfig } from '../domain/battle/types';
import type { ProfileStore } from '../state/createProfileStore';
import { BattleScene } from '../scenes/BattleScene';
import { definitionsFor } from '../scenes/campaignFlow';

/** A completed local match records a zero-resource settlement once. Demo/trial scenes do not use this wrapper. */
export function LocalCountedBattle({ config, store, upperAI, onRestart, onReturn }: {
  readonly config: BattleConfig; readonly store: ProfileStore; readonly upperAI: boolean;
  readonly onRestart: () => void; readonly onReturn: () => void;
}) {
  const [battleId, setBattleId] = useState(() => `local:${crypto.randomUUID()}`);
  const [round, setRound] = useState(0);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const saved = useRef(false), pending = useRef(false);
  const save = async () => {
    if (saved.current || pending.current) return;
    pending.current = true; setSaving(true); setError('');
    const result = await store.commitEconomic(profile => profile.settledBattleIds.includes(battleId)
      ? { rejected: '此场对战已记录。' }
      : { transaction: { operationId: battleId, settleBattleId: battleId, currencyDelta: {}, inventoryDelta: {} }, view: null });
    if (result.ok || store.getSnapshot().profile?.settledBattleIds.includes(battleId)) saved.current = true;
    else setError(`对战统计保存失败：${result.message}`);
    pending.current = false; setSaving(false);
  };
  const rematch = () => { saved.current = false; setError(''); setRound(r => r + 1); setBattleId(`local:${crypto.randomUUID()}`); };
  return <><BattleScene key={battleId} config={{ ...config, seed: (config.seed + round) >>> 0 }} definitions={definitionsFor([...config.playerDeck, ...config.enemyDeck])}
    localMultiplayer autoEnemy={upperAI} autoStart onRematchRequested={rematch} exitDisabled={saving || !!error}
    onFinished={() => void save()} onExit={onRestart} onLeave={onReturn} exitLabel="重新选卡"/>
    {error && <div role="alert" style={{ position: 'absolute', zIndex: 100, left: '50%', bottom: '15%', transform: 'translateX(-50%)', padding: 16, background: '#20262a', color: '#edce92', border: '1px solid #d4b677' }}>
      {error}<button type="button" className="btn" disabled={saving} onClick={() => void save()}>重试保存</button></div>}</>;
}
