import { create } from 'zustand';
import { cardDatabase, stages } from '../data';
import defaultsJson from '../data/enemy-deck-config.json';
import { cloneEnemyDeckConfig, parseEnemyDeckConfig, type EnemyDeckConfig } from '../domain/progression/enemyDeckConfig';

export const ENEMY_DECK_CONFIG_KEY = 'card-master-3d:dev-enemy-decks:v1';
export const enemyConfigStageIds = stages.chapters.flatMap(c => c.stages.map(s => s.id));
export function decodeEnemyConfig(value: unknown) { return parseEnemyDeckConfig(value, cardDatabase.definitions, enemyConfigStageIds); }
const defaults = decodeEnemyConfig(defaultsJson);
if (!defaults.ok) throw new Error(`项目敌阵默认配置无效：${defaults.message}`);
export const defaultEnemyDeckConfig = defaults.config;

interface ConfigState {
  readonly config: EnemyDeckConfig; readonly revision: number; readonly error: string;
  save: (draft: EnemyDeckConfig, expectedRevision: number) => { readonly ok: boolean; readonly message: string };
  reload: () => void;
}
function readConfig(): { config: EnemyDeckConfig; error: string } {
  if (!import.meta.env.DEV || typeof window === 'undefined') return { config: cloneEnemyDeckConfig(defaultEnemyDeckConfig), error: '' };
  try {
    const text = window.localStorage.getItem(ENEMY_DECK_CONFIG_KEY);
    if (!text) return { config: cloneEnemyDeckConfig(defaultEnemyDeckConfig), error: '' };
    const parsed = decodeEnemyConfig(JSON.parse(text));
    return parsed.ok ? { config: parsed.config, error: '' } : { config: cloneEnemyDeckConfig(defaultEnemyDeckConfig), error: `浏览器敌阵配置无效，暂用项目默认：${parsed.message}` };
  } catch { return { config: cloneEnemyDeckConfig(defaultEnemyDeckConfig), error: '无法读取浏览器敌阵配置，暂用项目默认。' }; }
}
export const useEnemyDeckConfigStore = create<ConfigState>((set, get) => ({
  ...readConfig(), revision: 0,
  save: (draft, expectedRevision) => {
    if (!import.meta.env.DEV) return { ok: false, message: '正式版本不开放开发敌阵编辑，请更新项目发布配置。' };
    if (get().revision !== expectedRevision) return { ok: false, message: '敌阵配置已在其他窗口变化，请先重载已保存配置。当前草稿仍保留。' };
    const result = decodeEnemyConfig(draft);
    if (!result.ok) return { ok: false, message: result.message };
    try {
      window.localStorage.setItem(ENEMY_DECK_CONFIG_KEY, JSON.stringify(result.config));
      set({ config: result.config, revision: get().revision + 1, error: '' });
      return { ok: true, message: '敌阵配置已保存；战役下次开战使用固定配置，天梯生成使用这些预设。' };
    } catch { return { ok: false, message: '浏览器存储写入失败，配置未生效，草稿保留。可先导出JSON。' }; }
  },
  reload: () => set(state => ({ ...readConfig(), revision: state.revision + 1 })),
}));
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const sync = (event: StorageEvent) => { if (event.key === ENEMY_DECK_CONFIG_KEY || event.key === null) useEnemyDeckConfigStore.getState().reload(); };
  window.addEventListener('storage', sync);
  if (import.meta.hot) import.meta.hot.dispose(() => window.removeEventListener('storage', sync));
}
