import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ABYSS_DARKEN_MS, ABYSS_DEPART_MS, ABYSS_STILL_DARKEN_MS } from '../scenes/abyssPresentation';
import { hideCardTip } from '../state/cardTipStore';
import { useForegroundTimeout } from './useForegroundTimeout';
import './abyssDeparture.css';

export function useAbyssDeparture(reduceMotion: boolean, onBlack: () => void) {
  const [phase, setPhase] = useState<'idle' | 'departing' | 'darkening' | 'handoff'>('idle');
  const locked = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [hidden, setHidden] = useState(() => document.hidden);
  const still = reduceMotion;
  const black = useRef(onBlack); black.current = onBlack;
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  const cancel = useCallback(() => {
    if (!locked.current) return;
    locked.current = false; setPhase('idle');
    // 焦点在layout effect中等inert移除后回还。
  }, []);
  const start = useCallback(() => {
    if (locked.current) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    hideCardTip(); locked.current = true; setPhase('departing');
  }, []);
  const finish = useCallback(() => { locked.current = false; setPhase('idle'); }, []);
  useEffect(() => {
    if (phase === 'idle') return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [phase, cancel]);
  useForegroundTimeout(phase === 'departing', still ? 0 : ABYSS_DEPART_MS, () => setPhase('darkening'));
  useForegroundTimeout(phase === 'darkening', still ? ABYSS_STILL_DARKEN_MS : ABYSS_DARKEN_MS, () => setPhase('handoff'));
  // 留一帧完全不透明的遮幕，再在同一React提交中切路由并移交黑屏。
  useForegroundTimeout(phase === 'handoff', 32, () => { black.current(); finish(); });
  const style = {
    '--abyss-depart-ms': `${still ? 0 : ABYSS_DEPART_MS}ms`,
    '--abyss-darken-ms': `${still ? ABYSS_STILL_DARKEN_MS : ABYSS_DARKEN_MS}ms`,
    '--abyss-play-state': hidden ? 'paused' : 'running',
  } as CSSProperties;
  useLayoutEffect(() => {
    if (phase === 'idle' && previousFocus.current?.isConnected) {
      previousFocus.current.focus({ preventScroll: true });
      previousFocus.current = null;
    }
  }, [phase]);
  return { phase, busy: phase !== 'idle', start, finish, cancel, style };
}
