import { useId } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { AbyssCountdown } from './AbyssCountdown';
import './abyssEntry.css';

/** Animated event emblem shares the existing abyss palette and adds no WebGL canvas. */
export function AbyssLogo() {
  const id=useId();
  return <svg viewBox="0 0 180 180" className="abyss-logo" aria-hidden="true" fill="none">
    <defs>
      <radialGradient id={`${id}-void`}><stop offset=".25" stopColor="#020106"/><stop offset=".65" stopColor="#170915"/><stop offset="1" stopColor="#b0455c"/></radialGradient>
      <linearGradient id={`${id}-ring`} x1="25" y1="25" x2="150" y2="155" gradientUnits="userSpaceOnUse"><stop stopColor="#ffe1bd"/><stop offset=".3" stopColor="#d75674"/><stop offset=".65" stopColor="#592853"/><stop offset="1" stopColor="#eea19a"/></linearGradient>
    </defs>
    <circle className="abyss-logo__core" cx="90" cy="90" r="48" fill={`url(#${id}-void)`}/>
    <g className="abyss-logo__orbit" stroke={`url(#${id}-ring)`} strokeLinecap="round">
      <ellipse cx="90" cy="90" rx="67" ry="25" transform="rotate(-32 90 90)" strokeWidth="6"/>
      <path d="M38 62c6-28 45-42 77-26 25 13 35 39 29 61M145 112c-10 31-56 41-83 19-18-15-26-35-21-52" strokeWidth="3"/>
      <path d="M52 42 42 54l9 2-12 15M137 111l-10 14 10 2-14 16" strokeWidth="2"/>
    </g>
    <g className="abyss-logo__sparks" fill="#ffe1bd"><circle cx="90" cy="17" r="3"/><circle cx="153" cy="117" r="2"/><circle cx="36" cy="136" r="2.5"/></g>
    <circle cx="90" cy="90" r="26" fill="#030107"/>
  </svg>;
}
export function AbyssEntry({onClick}:{readonly onClick:()=>void}){
  const still=useSettingsStore(state=>state.reduceMotion);
  return <button className="hub-abyss-entry" type="button" data-still={still} onClick={onClick}
    aria-label="进入深渊模式" title="深渊 · v3.0 新模式">
    <AbyssLogo/>
    <span className="hub-abyss-entry__copy"><strong>深渊<span>·v3.0新模式</span></strong><AbyssCountdown compact/></span>
  </button>;
}
