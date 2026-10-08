import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { SideId } from '../../domain/cards/types';
import { insertionSlots } from '../../domain/battle/turnActions';
import type { BattleSession } from '../presentation/session';
import { BATTLE_CARD_SCALE, CARD_SIZE, LAYOUT } from './layout';
import { slotPosition } from './placements';

export interface DeploymentDrag {
  readonly instanceId: string;
  readonly pointerId: number;
  readonly side: SideId;
  readonly position: readonly [number, number, number];
  readonly insertIndex: number | null;
  readonly startClient: readonly [number, number];
  readonly moved: boolean;
}
interface Props {
  readonly drag: DeploymentDrag | null;
  readonly session: BattleSession;
  readonly onMove: (drag: DeploymentDrag) => void;
  readonly onDrop: (drag: DeploymentDrag, cancel: boolean) => void;
}

/** Pointer capture continues outside the canvas; invalid drops and Escape restore the preview. */
export function DeploymentDragController({ drag, session, onMove, onDrop }: Props) {
  const { camera, gl } = useThree();
  const latest = useRef(drag);
  latest.current = drag;
  const id = drag?.instanceId;
  const pointerId = drag?.pointerId;
  useEffect(() => {
    if (!id || pointerId === undefined) return;
    const canvas = gl.domElement;
    const plane = new Plane(new Vector3(0, 1, 0), -0.24);
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const point = new Vector3();
    let finished = false;
    const update = (event: PointerEvent): DeploymentDrag | null => {
      const active = latest.current;
      if (!active || event.pointerId !== pointerId) return null;
      const bounds = canvas.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1,
        1 - (event.clientY - bounds.top) / Math.max(1, bounds.height) * 2);
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(plane, point)) return active;
      const origin = slotPosition(active.side, 'battle', 0);
      const index = Math.round((point.x - origin[0]) / LAYOUT.battleSpacing);
      const inRow = Math.abs(point.z - origin[2]) <= CARD_SIZE.height * BATTLE_CARD_SCALE * 0.6;
      const inCanvas = event.clientX >= bounds.left && event.clientX <= bounds.right &&
        event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      const insertIndex = inCanvas && inRow && insertionSlots(session.authoritative, active.side).includes(index) ? index : null;
      const next: DeploymentDrag = { ...active, position: [point.x, 0.24, point.z], insertIndex,
        moved: active.moved || Math.hypot(event.clientX - active.startClient[0], event.clientY - active.startClient[1]) > 5 };
      latest.current = next;
      return next;
    };
    const move = (event: PointerEvent): void => { const next = update(event); if (next) onMove(next); };
    const finish = (cancel: boolean, event?: PointerEvent): void => {
      if (finished || (event && event.pointerId !== pointerId)) return;
      finished = true;
      const active = event ? update(event) : latest.current;
      if (active) onDrop(active, cancel);
    };
    const up = (event: PointerEvent): void => finish(false, event);
    const cancel = (event: PointerEvent): void => finish(true, event);
    const blur = (): void => finish(true);
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') finish(true); };
    try { canvas.setPointerCapture(pointerId); } catch { /* Pointer may already have been released. */ }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', key);
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    };
  }, [id, pointerId, camera, gl, session, onMove, onDrop]);
  return null;
}
