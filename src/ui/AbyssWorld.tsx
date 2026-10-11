import type { MutableRefObject } from 'react';
import { AbyssVortex } from '../rendering/abyss/AbyssVortex';
import { useParallax } from './useParallax';
import './abyssHome.css';

/** 底图和全部烟雾共用同一扩边容器，视差不改变各层的相对位置。 */
export function AbyssWorld({ backgroundUrl, revealed, active, still, flash }: {
  readonly backgroundUrl: string;
  readonly revealed: boolean;
  readonly active: boolean;
  readonly still: boolean;
  readonly flash: MutableRefObject<number>;
}) {
  const parallax = useParallax(50, 5, revealed && active && !still);
  return <div ref={parallax} className="abyss-scene__world" data-visible={revealed} aria-hidden="true">
    <div className="abyss-world__parallax">
      <img className="abyss-scene__background" src={backgroundUrl} alt="" draggable={false} />
      {revealed && <AbyssVortex backgroundUrl={backgroundUrl} still={still} active={active} flash={flash} />}
    </div>
    <div className="abyss-scene__vignette" />
  </div>;
}
