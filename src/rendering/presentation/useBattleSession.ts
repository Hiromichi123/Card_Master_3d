import { useSyncExternalStore } from 'react';

import type { BattleSession, BattleSnapshot } from './session';

/**
 * 把会话桥到 React。
 *
 * `getSnapshot` 必须返回**同一个对象**直到真的发生变化——`BattleSession`
 * 里只在 `publish()` 重建快照，正是为了这一条；返回新字面量会让这个 hook
 * 判定「一直在变」并无限重渲染。
 */
export function useBattleSession(session: BattleSession): BattleSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
