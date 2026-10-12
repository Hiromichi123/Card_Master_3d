import { useSettingsStore } from '../state/settingsStore';
import { AI_DIFFICULTY_LABELS, AI_STYLE_LABELS } from '../domain/battle/ai/types';
import type { BattleSnapshot } from '../rendering/presentation/session';

export function AiDebugPanel({snapshot}:{snapshot:BattleSnapshot}) {
  const show=useSettingsStore(s=>s.showPerf);if(!show)return null;
  const ai=snapshot.lastAiDecision;
  const exportLog=()=>{
    const blob=new Blob([JSON.stringify({format:'card-master-ai-decisions',version:1,decisions:snapshot.aiHistory},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ai-decisions.json';a.click();URL.revokeObjectURL(url);
  };
  return <details className="battle-settings ai-debug"><summary>AI 决策 · {snapshot.aiBusy?'思考中':AI_DIFFICULTY_LABELS[snapshot.aiOptions.difficulty]}</summary>
    <small>{AI_STYLE_LABELS[snapshot.aiOptions.style]} · {ai?.reason??'等待首次决策'}</small>
    {ai&&<><div>{ai.selectedKey} · 推演 {ai.transitions} 步 · 采样 {ai.samples}</div>
      <ol>{ai.candidates.slice(0,3).map(row=><li key={row.key}>{row.key}：{row.score.toFixed(2)}</li>)}</ol></>}
    <button type="button" className="btn" onClick={exportLog} disabled={!snapshot.aiHistory.length}>导出决策记录</button>
  </details>;
}
