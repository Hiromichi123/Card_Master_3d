import { Suspense, useState } from 'react';

import { DataProbe } from './DataProbe';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * 路由用一个最小的状态机表达，不引入路由库
 * （PLAN 第 7 节：不预先引入大型插件框架）。
 * 场景多了之后再按需拆分。
 */
export type RouteId = 'probe' | 'battle' | 'viewer';

const ROUTES: { id: RouteId; label: string; hint: string }[] = [
  { id: 'probe', label: '数据自检', hint: '确认导入的数据能被应用读到' },
  { id: 'battle', label: '战斗场景', hint: 'P1 建立 3D 战桌与实体卡牌' },
  { id: 'viewer', label: '开发查看器', hint: 'P1 切换卡牌与特效参数' },
];

export function App() {
  const [route, setRoute] = useState<RouteId>('probe');

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
          </button>
        ))}
      </nav>

      <main className="app-main">
        {/* 错误边界包住场景，避免一个渲染错误把整个应用变成白屏 */}
        <ErrorBoundary>
          <Suspense fallback={<div className="app-loading">正在加载…</div>}>
            {route === 'probe' && <DataProbe />}
            {route === 'battle' && <Placeholder title="战斗场景" phase="P1" />}
            {route === 'viewer' && <Placeholder title="开发查看器" phase="P1" />}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="app-placeholder">
      <h1>{title}</h1>
      <p>尚未实现，计划在 {phase} 阶段完成。</p>
    </div>
  );
}
