import { useEffect, useState } from 'react';
import { formatAbyssCountdown, nextAbyssSettlement } from '../domain/progression/abyss';
import './abyssEntry.css';

export function AbyssCountdown({ className = '', compact = false }: { readonly className?: string; readonly compact?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => setNow(Date.now());
    const resume = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === 'hidden') return;
      update();
      timer = setInterval(update, 1000);
    };
    resume();
    document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, []);
  const deadline = nextAbyssSettlement(now);
  if(compact)return <span className={`abyss-countdown abyss-countdown--compact ${className}`} role="timer" aria-live="off" aria-label="深渊结算倒计时">
    <span>当期结算倒计时</span><time dateTime={new Date(deadline).toISOString()}>{formatAbyssCountdown(deadline-now)}</time>
  </span>;
  return <section className={`abyss-countdown ${className}`} aria-label="深渊结算倒计时">
    <div><span>距深渊结算</span><time dateTime={new Date(deadline).toISOString()}>{formatAbyssCountdown(deadline - now)}</time></div>
    <small>UTC+8 · 每周一04:00</small>
  </section>;
}
