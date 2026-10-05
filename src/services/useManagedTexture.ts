import { useEffect, useState } from 'react';
import type { Texture } from 'three';

import { assetManager } from './AssetManager';

/**
 * 从 `AssetManager` 取得纹理的 React 绑定。
 *
 * 关键点是 **acquire/release 必须成对且与组件生命周期对齐**：
 * 组件卸载或 URL 变化时立刻 `release`，引用计数归零后管理器才允许 LRU 淘汰。
 * 少一次 release 会让纹理永远回收不掉（旧版就是这样把图片字典撑爆的）。
 *
 * 故意不用 Suspense：卡牌是批量出现的，一个纹理没加载完就把整棵子树挂起，
 * 会让整手牌闪烁。这里先渲染无贴图的卡体，贴图到位后再补上。
 */
export function useManagedTexture(url: string | null): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return;
    }

    let cancelled = false;
    setTexture(null);

    void assetManager.acquire(url).then((resolved) => {
      // 组件已卸载 / URL 已变化时不要再 setState
      if (!cancelled) {
        setTexture(resolved);
      }
    });

    return () => {
      cancelled = true;
      assetManager.release(url);
    };
  }, [url]);

  return texture;
}
