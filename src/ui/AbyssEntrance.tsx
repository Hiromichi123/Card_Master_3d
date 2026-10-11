import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ABYSS_BUTTON_ENTER_MS, ABYSS_BUTTON_STAGGER_MS, ABYSS_UI_FADE_MS } from '../scenes/abyssPresentation';
import { useForegroundTimeout } from './useForegroundTimeout';

/** 动画归包装层所有，按钮本身的disabled、hover和焦点样式不参与入场动画。 */
export function AbyssEntrance({ index, play, still, children, onArrived }: {
  readonly index: number;
  readonly play: boolean;
  readonly still: boolean;
  readonly children: ReactNode;
  readonly onArrived?: (index: number) => void;
}) {
  const [arrived, setArrived] = useState(!play);
  const delay = still ? 0 : index * ABYSS_BUTTON_STAGGER_MS;
  const duration = still ? ABYSS_UI_FADE_MS : ABYSS_BUTTON_ENTER_MS;
  useForegroundTimeout(!arrived, delay + duration, () => setArrived(true));
  const notify = useRef(onArrived);
  notify.current = onArrived;
  useEffect(() => { if (arrived) notify.current?.(index); }, [arrived, index]);
  return <div className="abyss-entrance" data-arrived={arrived} data-still={still} inert={!arrived}
    style={{ '--abyss-enter-delay': `${delay}ms`, '--abyss-enter-duration': `${duration}ms` } as CSSProperties}>
    {children}
  </div>;
}
