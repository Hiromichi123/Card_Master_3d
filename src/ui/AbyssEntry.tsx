import { useId } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import './abyssEntry.css';

/** 原创裂隙与黑洞徽记，无额外WebGL画布。 */
export function AbyssLogo() {
  const id = useId();
  return <svg viewBox="0 0 180 180" className="abyss-logo" aria-hidden="true" fill="none">
    <defs>
      <radialGradient id={`${id}-void`}><stop offset=".25" stopColor="#020106" /><stop offset=".65" stopColor="#170915" /><stop offset="1" stopColor="#b0455c" /></radialGradient>
      <linearGradient id={`${id}-ring`} x1="25" y1="25" x2="150" y2="155" gradientUnits="userSpaceOnUse"><stop stopColor="#ffe1bd" /><stop offset=".3" stopColor="#d75674" /><stop offset=".65" stopColor="#592853" /><stop offset="1" stopColor="#eea19a" /></linearGradient>
    </defs>
    <path d="m90 8 58 29 24 53-24 53-58 29-58-29L8 90l24-53Z" stroke="#c36b73" strokeWidth="2" />
    <path d="m90 16 52 26 22 48-22 48-52 26-52-26-22-48 22-48Z" stroke="#a17b65" strokeOpacity=".45" />
    <circle cx="90" cy="90" r="48" fill={`url(#${id}-void)`} />
    <g className="abyss-logo__orbit" stroke={`url(#${id}-ring)`} strokeLinecap="round">
      <ellipse cx="90" cy="90" rx="67" ry="25" transform="rotate(-32 90 90)" strokeWidth="6" />
      <path d="M38 62c6-28 45-42 77-26 25 13 35 39 29 61M145 112c-10 31-56 41-83 19-18-15-26-35-21-52" strokeWidth="3" />
      <path d="M52 42 42 54l9 2-12 15M137 111l-10 14 10 2-14 16" strokeWidth="2" />
    </g>
    <circle cx="90" cy="90" r="26" fill="#030107" />
    <path d="m90 21 4 12-4 8-4-8ZM90 139l4 8-4 12-4-12Z" fill="#f1c0a1" />
  </svg>;
}

export function AbyssEntry({ onClick }: { readonly onClick: () => void }) {
  const still = useSettingsStore(state => state.reduceMotion);
  return <button className="hub-abyss-entry" type="button" data-still={still} onClick={onClick}
    aria-label="进入深渊模式" title="进入深渊 · 黑洞与雷霆之境">
    <AbyssLogo />
    <span className="hub-abyss-entry__copy"><small>THE ABYSS</small><strong>深渊降临 <b className="abyss-new">NEW</b></strong><span>越过裂隙，直面无尽黑暗</span></span>
    <span className="hub-abyss-entry__arrow" aria-hidden="true">↗</span>
  </button>;
}
