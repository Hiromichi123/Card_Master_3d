import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 活动海报轮播。
 *
 * 照旧版 `ui/activity_poster.py` 的 `PosterUI`：
 *
 * - **金边相框**：深色半透明底 + 8 设计单位金边、圆角 24、内边距 8，
 *   内框之外的部分一律不画（图会被裁进去）；
 * - **自动轮播**：每 5 秒切下一张，切换用 0.7 秒的横向滑动——
 *   旧的往左滑出、新的从右边滑进来（`direction` 为 −1 时整段镜像）；
 * - 到头**首尾相接**；
 * - 海报按「填满并裁切」缩放（`background-size: cover` 就是同一件事）。
 *
 * 尺寸由调用方给（旧版是**窗口的 35% × 30%**，不是固定像素）：
 * 这里只收 `width/height` 与两个时长，自己不去猜布局。
 *
 * **空闲时不跑 rAF**：轮播用定时器排下一次，只有那 0.7 秒的滑动期间才逐帧推进
 * （与 `useParallax`、`useFoilPointer` 同一条纪律——静止的画面一帧都不该转）。
 */
export interface PosterCarouselProps {
  readonly posters: readonly string[];
  /** 每张停留多久（毫秒）。 */
  readonly intervalMs?: number;
  /** 单次滑动时长（毫秒）。 */
  readonly durationMs?: number;
  /** 点海报。参数是当前这一张的下标。 */
  readonly onSelect?: (index: number) => void;
  /** 系统关了动效：直接换图，不滑。 */
  readonly still?: boolean;
}

export function PosterCarousel({
  posters,
  intervalMs = 5000,
  durationMs = 700,
  onSelect,
  still = false,
}: PosterCarouselProps) {
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [direction, setDirection] = useState(1);

  const count = posters.length;
  const indexRef = useRef(index);
  indexRef.current = index;

  /** 开始一次切换。已经在切就直接忽略——旧版也是这么处理竞态的。 */
  const step = useCallback(
    (delta: number): void => {
      if (count <= 1) {
        return;
      }
      const from = indexRef.current;
      const to = (from + delta + count) % count;
      setDirection(delta >= 0 ? 1 : -1);
      if (still) {
        setIndex(to);
        return;
      }
      setProgress(0);
      setTarget(to);
    },
    [count, still],
  );

  // 自动轮播：每次切换完成后重新排下一次（排定时器，不空转）
  useEffect(() => {
    if (count <= 1 || intervalMs <= 0) {
      return;
    }
    const timer = window.setTimeout(() => step(1), intervalMs);
    return () => window.clearTimeout(timer);
  }, [count, intervalMs, step, index, target]);

  /*
    滑动：只有这一段逐帧推进。用时间戳算进度而不是「每帧加固定值」，
    掉帧时不会把 0.7 秒拉长。
  */
  useEffect(() => {
    if (target === null) {
      return;
    }
    let raf = 0;
    let start = 0;
    const frame = (now: number): void => {
      if (start === 0) {
        start = now;
      }
      const p = durationMs <= 0 ? 1 : Math.min(1, (now - start) / durationMs);
      setProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(frame);
        return;
      }
      setIndex(target);
      setTarget(null);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  if (count === 0) {
    // 没有海报时也画相框（空的），而不是整块消失——位置与尺寸不该跳
    return <div className="poster" data-testid="poster-carousel" />;
  }

  const easing = progress * progress * (3 - 2 * progress);
  const current = posters[index] ?? '';
  const incoming = target === null ? current : (posters[target] ?? '');
  /*
    **不在切换时位移必须是 0。**
    `progress` 在动画结束后停在 1，如果照旧算 `100%`，那一张图会一直停在屏幕外，
    内框只剩底色——表现就是「翻完页海报变成一块灰」。
    切换结束后 `target` 归 null，这里跟着归零。
  */
  const shift = target === null ? 0 : easing * 100 * direction;

  return (
    <div
      className="poster"
      data-testid="poster-carousel"
      data-poster-index={index}
      role="button"
      tabIndex={0}
      title="点击进入战役"
      onClick={() => onSelect?.(index)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect?.(index);
        }
      }}
    >
      <div className="poster__inner">
        <div
          className="poster__art"
          style={{
            backgroundImage: current ? `url(${current})` : undefined,
            transform: `translateX(${-shift}%)`,
          }}
        />
        {target !== null && (
          <div
            className="poster__art"
            style={{
              backgroundImage: incoming ? `url(${incoming})` : undefined,
              transform: `translateX(${direction * 100 - shift}%)`,
            }}
          />
        )}
      </div>
      {/* 小圆点指示器：旧版没有，但没有它就看不出这是「一组」而不是一张图 */}
      <div className="poster__dots" aria-hidden="true">
        {posters.map((url, dot) => (
          <span
            key={url}
            className={dot === index ? 'poster__dot poster__dot--on' : 'poster__dot'}
          />
        ))}
      </div>
    </div>
  );
}
