import { AI_DIFFICULTIES, AI_DIFFICULTY_LABELS, AI_STYLES, AI_STYLE_LABELS, AI_POLICIES, AI_POLICY_LABELS,
  type AiDifficulty, type AiStyle, type AiPolicy } from '../domain/battle/ai/types';
import { useSettingsStore } from '../state/settingsStore';
import { useAiModelStore } from '../state/aiModelStore';
import './ai.css';

export function AiSettingsControls(){
  const difficulty=useSettingsStore(s=>s.aiDifficulty),style=useSettingsStore(s=>s.aiStyle),policy=useSettingsStore(s=>s.aiPolicy);
  const setAi=useSettingsStore(s=>s.setAi),{model,error,importJson,clear}=useAiModelStore();
  return <>
    <label className="battle-settings__group"><span className="battle-settings__label">人机难度</span>
      <select className="battle-settings__select" aria-label="人机难度" value={difficulty} onChange={e=>setAi({difficulty:e.target.value as AiDifficulty})}>
        {AI_DIFFICULTIES.map(v=><option key={v} value={v}>{AI_DIFFICULTY_LABELS[v]}</option>)}
      </select></label>
    <label className="battle-settings__group"><span className="battle-settings__label">人机风格</span>
      <select className="battle-settings__select" aria-label="人机风格" value={style} onChange={e=>setAi({style:e.target.value as AiStyle})}>
        {AI_STYLES.map(v=><option key={v} value={v}>{AI_STYLE_LABELS[v]}</option>)}
      </select></label>
    <label className="battle-settings__group"><span className="battle-settings__label">决策策略</span>
      <select className="battle-settings__select" aria-label="决策策略" value={policy} onChange={e=>setAi({policy:e.target.value as AiPolicy})}>
        {AI_POLICIES.map(v=><option key={v} value={v}>{AI_POLICY_LABELS[v]}</option>)}
      </select></label>
    <div className="battle-settings__group battle-settings__model">
      <span className="battle-settings__label">学习模型：{model?.name??'未载入（使用规则策略）'}</span>
      <label className="battle-settings__seg">导入模型 JSON<input type="file" accept=".json,application/json" style={{maxWidth:'100%'}} onChange={e=>{
        const file=e.target.files?.[0];e.target.value='';
        if(file?.size&&file.size>500000){useAiModelStore.setState({error:'模型文件超过 500 KB'});return;}
        if(file)void file.text().then(importJson).catch(()=>useAiModelStore.setState({error:'文件读取失败'}));
      }}/></label>
      {model&&<button type="button" className="battle-settings__seg" onClick={clear}>卸载模型</button>}
      {error&&<small role="status">{error}</small>}
      <small>深渊难度跟随本战设定；学习模型仅在“学习＋推演”启用。当前不附带训练模型。</small>
    </div>
  </>;
}
