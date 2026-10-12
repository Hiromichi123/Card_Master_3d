import { useRef, useState } from 'react';
import { AbyssHomeCrystals, type AbyssCrystalEntry } from './AbyssHomeCrystals';
import './abyssCampCrystals.css';

/** Compact intermission controls reuse the same gold-purple crystal models as the lobby. */
export function AbyssCampCrystals({ entries, still }: {
  readonly entries: readonly (AbyssCrystalEntry & { readonly pressed?: boolean })[];
  readonly still: boolean;
}) {
  const anchors = useRef(new Map<number, HTMLSpanElement>());
  const [active, setActive] = useState<number | null>(null), [ready, setReady] = useState(false);
  return <nav className="abyss-camp-nav abyss-camp-crystals" aria-label="盘面局间整备" data-crystals-ready={ready} data-still={still}>
    <AbyssHomeCrystals entries={entries} anchors={anchors} active={active} still={still} onReady={() => setReady(true)} />
    {entries.map((entry, index) => <button key={index} type="button" className="abyss-camp-crystals__option"
      disabled={entry.disabled} aria-label={`${entry.title}，${entry.detail}`} aria-pressed={entry.pressed} onClick={entry.action}
      onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}>
      <span className="abyss-camp-crystals__anchor" aria-hidden="true" ref={node => { if (node) anchors.current.set(index, node); else anchors.current.delete(index); }} />
      <strong>{entry.title}</strong><small>{entry.detail}</small>
    </button>)}
  </nav>;
}
