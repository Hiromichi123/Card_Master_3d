import { useFrame } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import type { Group } from 'three';

/** Draw the final cards back through the table while leaving its environment untouched. */
export function BattleActorExit({ clearing, children }: { readonly clearing: boolean; readonly children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (!group.current || document.hidden) return;
    const blend = 1 - Math.exp(-Math.min(.1, delta) * 7);
    group.current.position.y += ((clearing ? -3.4 : 0) - group.current.position.y) * blend;
  });
  return <group ref={group}>{children}</group>;
}
