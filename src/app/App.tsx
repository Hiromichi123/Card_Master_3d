import { Suspense, useEffect, useState } from 'react';

import { BattleScene } from '../scenes/BattleScene';
import { CollectionScene } from '../scenes/CollectionScene';
import { DeckEditorScene } from '../scenes/DeckEditorScene';
import { EffectLabScene } from '../scenes/EffectLabScene';
import { ActivityScene } from '../scenes/ActivityScene';
import { BattleMenuScene } from '../scenes/BattleMenuScene';
import { GachaScene } from '../scenes/GachaScene';
import { ShopScene } from '../scenes/ShopScene';
import { HubScene } from '../scenes/HubScene';
import { getProfileStore } from '../state/profileStore';
import type { ProfileStore } from '../state/createProfileStore';
import { pushToast } from '../state/toastStore';
import { useProfileStore } from '../state/useProfileStore';
import { QualityControl } from '../ui/QualityControl';
import { ScreenPlaceholder } from '../ui/ScreenPlaceholder';
import { ToastHost } from '../ui/ToastHost';
import { DataProbe } from './DataProbe';
import { ErrorBoundary } from './ErrorBoundary';
import { ROUTES, type RouteId } from './routes';

/**
 * 应用外壳。
 *
 * 三件事同时在这里做，每一件都有必须放在这一层的理由：
 *
 * 1. **存档的加载门禁**。屏幕要读 `profile`，而它是异步来的；
 *    在 `ready` 之前不挂载任何屏幕，既避免了一堆 `profile === null` 的分支，
 *    也保证了「设置水合完成」早于任何用户操作。
 * 2. **路由**。仍然是一个 `useState` 状态机，没有路由库。
 * 3. **关卡启动载荷**。战役选关后要把这一局的卡组与奖励带进战斗场景，
 *    它是跨屏幕的一次性数据，放这里最直观。
 */
export function App() {
  const [route, setRoute] = useState<RouteId>('hub');
  const [store, setStore] = useState<ProfileStore | null>(null);

  useEffect(() => {
    let alive = true;
    void getProfileStore().then((opened) => {
      if (!alive) {
        return;
      }
      setStore(opened);
      // `load()` 是幂等的：StrictMode 会让这个 effect 跑两次
      void opened.load();
    });
    return () => {
      alive = false;
    };
  }, []);

  const snapshot = useProfileStore(store);

  // 打不开 IndexedDB 时，降级必须**看得见**——静默不落盘是最坏的失败
  useEffect(() => {
    if (snapshot.fallbackReason) {
      pushToast(`无法持久化存档：${snapshot.fallbackReason}`, 'error');
    }
  }, [snapshot.fallbackReason]);

  return (
    <div className="app-shell">
      <nav className="app-nav">
        <span className="app-nav__brand">Card Master 3D</span>
        {ROUTES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              item.id === route ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'
            }
            onClick={() => setRoute(item.id)}
            title={item.hint}
          >
            {item.label}
            {item.dev && <span className="app-nav__dev">开发</span>}
          </button>
        ))}
        <span className="app-nav__spacer" />
        <QualityControl />
      </nav>

      <main className="app-main">
        {/* 错误边界包住场景，避免一个渲染错误把整个应用变成白屏 */}
        <ErrorBoundary>
          <Suspense fallback={<div className="app-loading">正在加载…</div>}>
            <Screen
              route={route}
              snapshot={snapshot}
              store={store}
              onNavigate={setRoute}
              onReset={() => {
                void store?.resetProfile();
              }}
            />
          </Suspense>
        </ErrorBoundary>
      </main>

      <ToastHost />
    </div>
  );
}

interface ScreenProps {
  readonly route: RouteId;
  readonly snapshot: ReturnType<typeof useProfileStore>;
  /**
   * 存档实例本身（不只是快照）。
   *
   * 抽卡要 `commitEconomic`（落盘前不确认），配置页要 `saveDeck`/`flush`——
   * 这两件事都必须在屏幕里发号施令，光有只读的 `profile` 做不了。
   */
  readonly store: ProfileStore | null;
  readonly onNavigate: (route: RouteId) => void;
  readonly onReset: () => void;
}

/**
 * 屏幕分发。
 *
 * **加载门禁只对游戏屏幕生效**：数据自检与实验台是开发工具，
 * 不读存档，让它们也等存档就绪没有意义。
 */
function Screen({ route, snapshot, store, onNavigate, onReset }: ScreenProps) {
  // 开发工具放行
  if (route === 'probe') {
    return <DataProbe />;
  }
  if (route === 'viewer') {
    return <EffectLabScene />;
  }

  if (snapshot.status === 'loading') {
    return <div className="app-loading">正在读取存档…</div>;
  }
  if (snapshot.status === 'error') {
    return (
      <div className="app-error" role="alert">
        <h1>存档读取失败</h1>
        <p className="app-error__message">{snapshot.error}</p>
        <p className="app-error__message">
          存档读不出来时不要继续操作——这一局做的所有事都存不下来。
        </p>
      </div>
    );
  }

  const profile = snapshot.profile;
  // `store` 比 `profile` 早一步就绪（profile 是从 store 里读出来的），
  // 两者都没有才等于「还没好」
  if (!profile || !store) {
    return <div className="app-loading">正在读取存档…</div>;
  }

  switch (route) {
    case 'hub':
      return <HubScene profile={profile} onNavigate={onNavigate} onReset={onReset} />;
    case 'battle':
      return (
        <div className="scene-viewport">
          <BattleScene />
        </div>
      );
    case 'campaign':
      return <ScreenPlaceholder title="战役" note="关卡选择正在施工（P5-M6）。" />;
    case 'gacha':
      return <GachaScene profile={profile} store={store} busy={snapshot.busy} onReturn={() => onNavigate('hub')} />;
    case 'collection':
      return <CollectionScene profile={profile} />;
    case 'deck':
      return <DeckEditorScene profile={profile} store={store} />;
    case 'shop':
      return <ShopScene profile={profile} store={store} busy={snapshot.busy} kind="normal" />;
    case 'activityShop':
      return <ShopScene profile={profile} store={store} busy={snapshot.busy} kind="activity" />;
    case 'battlemenu':
      return <BattleMenuScene profile={profile} onNavigate={onNavigate} />;
    case 'activity':
      return <ActivityScene profile={profile} onNavigate={onNavigate} />;
    case 'settings':
      return <ScreenPlaceholder title="设置" note="设置页正在施工（P5-M7）。" />;
    default:
      return <HubScene profile={profile} onNavigate={onNavigate} onReset={onReset} />;
  }
}
