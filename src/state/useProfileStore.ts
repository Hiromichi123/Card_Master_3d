import { useSyncExternalStore } from 'react';

import type { ProfileSnapshot, ProfileStore } from './createProfileStore';

/**
 * 把存档桥到 React。
 *
 * 与 `useBattleSession` 是同一套写法：`getSnapshot` 返回**同一个对象**直到真的变化，
 * 这一点由 `ProfileStore.publish()` 保证。返回新字面量会让这个 hook
 * 判定「一直在变」并无限重渲染。
 *
 * 接受 `null`（存档还没打开）：界面在那种情况下渲染的是加载态，
 * 而不是把 hook 放到条件分支里——条件调用 hook 会破坏调用顺序。
 */
const LOADING: ProfileSnapshot = {
  status: 'loading',
  storage: 'memory',
  fallbackReason: null,
  profile: null,
  error: null,
  busy: false,
  lastResult: null,
};

export function useProfileStore(store: ProfileStore | null): ProfileSnapshot {
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : () => LOADING,
    store ? store.getSnapshot : () => LOADING,
  );
}

function noopSubscribe(): () => void {
  return () => {};
}
