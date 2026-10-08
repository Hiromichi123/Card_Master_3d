import { Suspense, useCallback, useEffect, useState } from 'react';

import { BattleScene } from '../scenes/BattleScene';
import { CollectionScene } from '../scenes/CollectionScene';
import { DeckEditorScene } from '../scenes/DeckEditorScene';
import { EffectLabScene } from '../scenes/EffectLabScene';
import { ActivityScene } from '../scenes/ActivityScene';
import { CampaignScene } from '../scenes/CampaignScene';
import { BattleMenuScene } from '../scenes/BattleMenuScene';
import { LocalBattleScene } from '../scenes/LocalBattleScene';
import { GachaScene } from '../scenes/GachaScene';
import { FusionScene } from '../scenes/FusionScene';
import { MazeScene } from '../scenes/MazeScene';
import { ShopScene } from '../scenes/ShopScene';
import { SettingsScene } from '../scenes/SettingsScene';
import { HubScene } from '../scenes/HubScene';
import { getProfileStore } from '../state/profileStore';
import type { ProfileStore } from '../state/createProfileStore';
import { pushToast } from '../state/toastStore';
import { attachSettingsPersistence, hydrateSettings } from '../state/settingsPersistence';
import { useSettingsStore } from '../state/settingsStore';
import { audioEngine, unlockAudioOnFirstGesture } from '../services/audio/AudioEngine';
import { SceneBackgroundProvider } from '../ui/SceneBackground';
import { useProfileStore } from '../state/useProfileStore';
import { PerfToggle } from '../ui/BattleSettings';
import { configFor, definitionsFor, settlementFor } from '../scenes/campaignFlow';
import type { SettlementView, StageLaunch } from '../domain/progression/campaign';
import { planSettlement } from '../domain/progression/campaign';
import { isMazeLaunch, mazeSettlementFor, planMazeSettlement } from '../scenes/mazeFlow';
import type { BattleOutcome } from '../domain/battle/types';
import { CardTipHost } from '../ui/CardTipHost';
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
  /** 抬头是否收起。只活在这一会话里（与其余设置一样，不进存档）。 */
  const [navCollapsed, setNavCollapsed] = useState(false);
  /*
    这一局的战役启动参数与它的结算。

    它们是**跨屏幕的一次性数据**（地图屏 → 战斗屏 → 结果面板），
    放在这一层最直观：屏幕是挂载/卸载式的，参数留在屏幕里会随卸载丢掉。
  */
  const [launch, setLaunch] = useState<StageLaunch | null>(null);
  const [settlement, setSettlement] = useState<SettlementView | null>(null);

  /**
   * 提交一关的结算。
   *
   * 算奖励是**纯函数**（`settlementFor`，随机流由 `battleId` 派生），
   * 提交是**一笔事务**（金币/经验/水晶/掉落的卡/通关记录一起写）。
   * `battleId` 进事务，所以同一局再算一次会被存档层按 id 挡掉——
   * 「返回/重载/重复点击只能领一次」靠的是这一条，不是界面上的禁用。
   *
   * **迷宫与战役在这里分流**：两条路径的奖励算得不一样（迷宫按节点类型与强度、
   * 不写通关记录），但都产出 `SettlementView`、都走同一次事务提交，
   * 所以这一段只换「算奖励」和「包事务」两个函数，后面的落盘与结果面板完全共用。
   */
  const commitSettlement = useCallback(
    async (outcome: BattleOutcome) => {
      if (!launch || !store) {
        return;
      }
      const maze = isMazeLaunch(launch);
      const computed = maze ? mazeSettlementFor(launch, outcome) : settlementFor(launch, outcome);
      const result = await store.commitEconomic<SettlementView>(() =>
        maze
          ? planMazeSettlement(launch, computed, store.nextOperationId())
          : planSettlement(launch, computed, store.nextOperationId()),
      );
      if (result.ok) {
        setSettlement(result.view);
        return;
      }
      // 存档层已经 toast 过原因；这里只补一句「奖励没发出去」
      pushToast(`奖励没能发放：${result.message}`, 'error');
    },
    [launch, store],
  );
  // Scene UI switches immediately; background layers blend across route mounts.
  const navigate = useCallback((next: RouteId) => { setRoute(next); }, []);

  useEffect(() => {
    let alive = true;
    let detachSettings: (() => void) | null = null;
    void getProfileStore().then(async (opened) => {
      if (!alive) {
        return;
      }
      setStore(opened);
      // `load()` 是幂等的：StrictMode 会让这个 effect 跑两次
      await opened.load();
      if (!alive) {
        return;
      }
      /*
        设置的两条线在这里接上（见 state/settingsPersistence）：

        先「存档 → store」，再「store → 存档」。顺序不能反——后者记下的
        「上一帧值」是水合之后的值，于是水合本身不会触发一次多余的写盘。
        这一步早于任何屏幕渲染（App 只在 `ready` 之后才挂屏幕）。
      */
      const loaded = opened.getSnapshot().profile;
      if (loaded) {
        hydrateSettings(loaded);
      }
      detachSettings = attachSettingsPersistence(opened);
    });
    return () => {
      alive = false;
      detachSettings?.();
    };
  }, []);

  const snapshot = useProfileStore(store);

  /*
    音频（2026-10-08）。

    解锁挂在 App 而不是某个屏幕：屏幕是挂载/卸载式的，而玩家的第一次点击
    很可能落在主菜单的导航上——如果监听挂在战斗屏或设置屏里，那第一次点击
    就已经花掉了、音频还没解锁。App 是唯一从启动到退出都挂着的组件。

    音量读 zustand（设置的运行期唯一真相），存档镜像由 settingsPersistence 负责。
  */
  const masterVolume = useSettingsStore((state) => state.masterVolume);
  useEffect(() => unlockAudioOnFirstGesture(), []);
  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  // 打不开 IndexedDB 时，降级必须**看得见**——静默不落盘是最坏的失败
  useEffect(() => {
    if (snapshot.fallbackReason) {
      pushToast(`无法持久化存档：${snapshot.fallbackReason}`, 'error');
    }
  }, [snapshot.fallbackReason]);

  return (
    <SceneBackgroundProvider>
    <div className="app-shell">
      {/*
        抬头可手动收起（2026-10-07）：3D 屏（战桌、实验台、抽卡）最想要的是纵向空间，
        而抬头在那些屏上只是「我现在不想切屏」。收起来只剩品牌与一个展开按钮，
        再点就回来——状态不进存档，刷新即恢复展开。
      */}
      <nav className={navCollapsed ? 'app-nav app-nav--collapsed' : 'app-nav'}>
        <span className="app-nav__brand">Card Master 3D</span>
        {!navCollapsed &&
          ROUTES.filter((item) => !['maze', 'draft'].includes(item.id)).map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                item.id === route ? 'app-nav__tab app-nav__tab--active' : 'app-nav__tab'
              }
              onClick={() => navigate(item.id)}
              title={item.hint}
            >
              {item.label}
              {item.dev && <span className="app-nav__dev">开发</span>}
            </button>
          ))}
        <span className="app-nav__spacer" />
        {!navCollapsed && <PerfToggle />}
        <button
          type="button"
          className="app-nav__toggle"
          onClick={() => setNavCollapsed((current) => !current)}
          aria-label={navCollapsed ? '展开导航' : '收起导航'}
          aria-expanded={!navCollapsed}
          title={navCollapsed ? '展开导航' : '收起导航（多为 3D 画面腾出纵向空间）'}
        >
          {navCollapsed ? '▾ 展开导航' : '▴'}
        </button>
      </nav>

      <main className="app-main">
        {/* 错误边界包住场景，避免一个渲染错误把整个应用变成白屏 */}
        <ErrorBoundary>
          <Suspense fallback={<div className="app-loading">正在加载…</div>}>
            <Screen
              route={route}
              snapshot={snapshot}
              store={store}
              launch={launch}
              settlement={settlement}
              onStageLaunch={(next) => {
                setSettlement(null);
                setLaunch(next);
                navigate('battle');
              }}
              onBattleFinished={(outcome) => {
                void commitSettlement(outcome);
              }}
              onBattleExit={() => {
                // 打完回**来的地方**：迷宫回地图屏、战役回战役屏
                const back: RouteId = launch && isMazeLaunch(launch) ? 'maze' : 'campaign';
                setLaunch(null);
                setSettlement(null);
                navigate(back);
              }}
              onNavigate={navigate}
              onReset={() => {
                void store?.resetProfile();
              }}
            />
          </Suspense>
        </ErrorBoundary>
      </main>

      <ToastHost />
      {/* 悬停卡牌详情：全应用挂一次，卡片只要带 `data-card-id` 就自动有 */}
      <CardTipHost />

    </div>
    </SceneBackgroundProvider>
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
  /** 这一局的战役启动参数（演示战斗时为 null）。 */
  readonly launch: StageLaunch | null;
  readonly settlement: SettlementView | null;
  readonly onStageLaunch: (launch: StageLaunch) => void;
  readonly onBattleFinished: (outcome: BattleOutcome) => void;
  readonly onBattleExit: () => void;
  readonly onNavigate: (route: RouteId) => void;
  readonly onReset: () => void;
}

/**
 * 屏幕分发。
 *
 * **加载门禁只对游戏屏幕生效**：数据自检与实验台是开发工具，
 * 不读存档，让它们也等存档就绪没有意义。
 */
function Screen({
  route,
  snapshot,
  store,
  launch,
  settlement,
  onStageLaunch,
  onBattleFinished,
  onBattleExit,
  onNavigate,
  onReset,
}: ScreenProps) {
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
          <BattleScene
            {...(launch
              ? {
                  config: configFor(launch),
                  definitions: definitionsFor([...launch.playerDeck, ...launch.enemyDeck]),
                  settlement,
                  onFinished: onBattleFinished,
                  onExit: onBattleExit,
                  // 迷宫回地图屏、战役回战役屏——按钮文案得跟着变
                  exitLabel: isMazeLaunch(launch) ? '返回地图' : '返回战役',
                }
              : {})}
          />
        </div>
      );
    case 'campaign':
      return (
        <CampaignScene profile={profile} onNavigate={onNavigate} onLaunch={onStageLaunch} />
      );
    case 'maze':
      return (
        <MazeScene
          profile={profile}
          store={store}
          onNavigate={onNavigate}
          onLaunch={onStageLaunch}
        />
      );
    case 'gacha':
      return <GachaScene profile={profile} store={store} busy={snapshot.busy} onReturn={() => onNavigate('hub')} />;
    case 'fusion':
      return <FusionScene profile={profile} store={store} busy={snapshot.busy} onReturn={() => onNavigate('hub')} />;
    case 'collection':
      return <CollectionScene profile={profile} />;
    case 'deck':
      return <DeckEditorScene profile={profile} store={store} />;
    case 'shop':
      return (
        <ShopScene
          profile={profile}
          store={store}
          busy={snapshot.busy}
          kind="normal"
          onNavigate={onNavigate}
        />
      );
    case 'activityShop':
      return (
        <ShopScene
          profile={profile}
          store={store}
          busy={snapshot.busy}
          kind="activity"
          onNavigate={onNavigate}
        />
      );
    case 'localBattle':
      return <LocalBattleScene onReturn={() => onNavigate('battlemenu')} />;
    case 'battlemenu':
      return <BattleMenuScene profile={profile} onNavigate={onNavigate} />;
    case 'activity':
      return <ActivityScene profile={profile} onNavigate={onNavigate} />;
    case 'settings':
      return <SettingsScene profile={profile} store={store} onNavigate={onNavigate} />;
    default:
      return <HubScene profile={profile} onNavigate={onNavigate} onReset={onReset} />;
  }
}
