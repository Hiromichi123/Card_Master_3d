import { useEffect, useState, type ReactNode } from 'react';

/**
 * WebGL2 可用性检查。
 *
 * 施工清单 P7 要求「WebGL 不可用、纹理失败、存档失败时给出可操作提示」。
 * 这里先把最容易失败的一件事做掉：在挂载 Canvas **之前**探测 WebGL2，
 * 避免 R3F 在初始化时直接抛错、用户只看到白屏。
 *
 * 注意：`three` 当前的 WebGLRenderer 走 WebGL2（PLAN 第 2 节），
 * 所以这里只接受 `webgl2`。
 */

type Status = 'checking' | 'ready' | 'unavailable';

function detectWebGL2(): Status {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    if (!context) {
      return 'unavailable';
    }
    // 主动丢弃探测用的上下文，避免占用一个 WebGL 上下文名额
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return 'ready';
  } catch {
    return 'unavailable';
  }
}

export function WebGLGuard({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    setStatus(detectWebGL2());
  }, []);

  if (status === 'checking') {
    return <div className="app-loading">正在检查 WebGL2 支持…</div>;
  }

  if (status === 'unavailable') {
    return (
      <div className="app-error" role="alert">
        <h1>无法启动 3D 场景</h1>
        <p className="app-error__message">
          当前浏览器或显卡驱动没有提供可用的 WebGL2 上下文。本演示的卡牌与特效都依赖
          WebGL2，无法降级为 2D 运行。
        </p>
        <ul>
          <li>确认使用的是 Chrome 或 Edge 的较新版本</li>
          <li>在浏览器地址栏打开 <code>chrome://gpu</code>，确认 WebGL2 未被禁用</li>
          <li>更新显卡驱动后重启浏览器</li>
        </ul>
      </div>
    );
  }

  return <>{children}</>;
}
