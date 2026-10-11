import type { MazeNodeType } from '../domain/progression/maze';

/** 世界树迷宫的地块徽记；顶面、图例与详情共用同一套线稿。 */
export function MazeNodeIcon({ type }: { readonly type: MazeNodeType | 'complete' }) {
  return (
    <svg className="maze__icon" data-maze-icon={type} viewBox="0 0 64 64" fill="none"
      stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {type === 'entry' && <>
        <path d="M32 51V27M32 37C15 39 10 27 12 16c13-1 22 6 20 21ZM32 29C30 15 39 8 53 10c1 12-7 22-21 19Z" />
        <path d="m20 24 12 13 12-18M21 54l11-7 11 7M14 56h36" />
      </>}
      {type === 'normal' && <>
        <path d="m13 10 10 3 27 29-8 8-29-27-3-10ZM51 10l-10 3-8 9M22 33l-9 9 9 9 9-9M36 45l13-13M15 32l13 13M43 49l9 9M21 49l-9 9" />
      </>}
      {type === 'elite' && <>
        <path d="m32 7 20 8v18c0 12-13 21-20 25-7-4-20-13-20-25V15Z" />
        <path d="m32 18 4 9 10 1-8 7 2 10-8-5-8 5 2-10-8-7 10-1ZM6 25v13M58 25v13" />
      </>}
      {type === 'boss' && <>
        <path d="m10 21 12 9L32 13l10 17 12-9-5 26H15ZM16 53h32M21 40h22" />
        <circle cx="10" cy="17" r="3" /><circle cx="32" cy="9" r="3" /><circle cx="54" cy="17" r="3" />
      </>}
      {type === 'supply' && <>
        <path d="M23 21 18 9l14 4 14-4-5 12M23 21C13 31 8 40 12 49c4 10 36 10 40 0 4-9-1-18-11-28ZM22 22h20M25 27h14" />
        <circle cx="32" cy="41" r="9" /><path d="M32 36v10m-3-8 3-2 3 2" />
      </>}
      {type === 'complete' && <><circle cx="32" cy="32" r="26" /><path d="m18 32 9 10 19-21" /></>}
    </svg>
  );
}
