import type { ReactNode } from 'react';

const MARKS: readonly ReactNode[] = [
  <><path d="M24 39V22M24 28C9 29 8 15 9 12c12-1 17 6 15 16ZM24 22C24 11 32 7 39 9c0 10-5 16-15 16" /></>,
  <><path d="m10 8 25 27M38 8 13 35M10 8l1 10 7-7ZM38 8l-1 10-7-7ZM9 29l10 10M29 39l10-10M8 40l6-6M34 34l6 6" /></>,
  <><path d="m24 5 16 7-3 19-13 12L11 31 8 12Z" /><path d="m24 13 4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1Z" /></>,
  <><path d="m24 11 7 12-7 17-7-17ZM17 23 5 10l2 19 13 6M31 23l12-13-2 19-13 6M7 21l11 8M41 21l-11 8" /></>,
  <><path d="m15 7 18 0 9 14-18 22L6 21ZM6 21h36M15 7l9 36L33 7M15 7l9 14 9-14" /></>,
  <><circle cx="24" cy="24" r="13" /><path d="M24 3v11M24 34v11M3 24h11M34 24h11M9 9l7 7M32 32l7 7M9 39l7-7M32 16l7-7m-15 5 7 10-7 10-7-10Z" /></>,
  <><path d="m7 14 9 9 8-15 8 15 9-9-4 23H11ZM11 37h26M14 42h20" /><circle cx="7" cy="11" r="2" /><circle cx="24" cy="5" r="2" /><circle cx="41" cy="11" r="2" /></>,
  <><path d="M4 25Q24 3 44 25 24 45 4 25ZM12 13 9 5l12 7M36 13l3-8-12 7" /><circle cx="24" cy="25" r="8" /><path d="m24 18-3 7 3 7 3-7Z" /></>,
  <><circle cx="24" cy="24" r="15" /><ellipse cx="24" cy="24" rx="8" ry="15" /><path d="M9 24h30M5 35 43 13M5 35l3-8M43 13l-8 1m-11-14 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /></>,
];

/** 原创线绘徽章；不依赖WebGL，也不只靠颜色辨认段位。 */
export function LadderRankIcon({ floor, color }: { floor: number; color: string }) {
  return <svg className="ladder-rank-icon" viewBox="0 0 48 48" fill="none" stroke={color}
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-tier-logo={floor}>
    {MARKS[Math.max(0, Math.min(8, Math.floor(floor / 300)))]}
  </svg>;
}
