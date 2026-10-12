import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { choicePartyHit, type ChoicePoint, type choicePartyLayout } from './abyssChoiceLayout';

export interface AbyssChoiceDrag {
  readonly index: number;
  readonly pointerId: number;
  readonly startClient: readonly [number, number];
  readonly position: ChoicePoint;
  readonly targetId: string | null;
  readonly moved: boolean;
}
export function AbyssChoiceDragController({ drag, layout, onMove, onDrop }: {
  readonly drag: AbyssChoiceDrag | null;
  readonly layout: ReturnType<typeof choicePartyLayout>;
  readonly onMove: (value: AbyssChoiceDrag) => void;
  readonly onDrop: (value: AbyssChoiceDrag, cancel: boolean) => void;
}) {
  const { camera, gl } = useThree();
  const latest = useRef({ drag, layout, onMove, onDrop }); latest.current = { drag, layout, onMove, onDrop };
  const pointerId = drag?.pointerId, index = drag?.index;
  useEffect(() => {
    if (pointerId === undefined || index === undefined) return;
    const canvas = gl.domElement, plane = new Plane(new Vector3(0, 1, 0), -.65);
    const raycaster = new Raycaster(), pointer = new Vector2(), point = new Vector3();
    let finished = false;
    const update = (event: PointerEvent) => {
      const active = latest.current.drag;
      if (!active || event.pointerId !== pointerId) return null;
      const rect = canvas.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1,
        1 - (event.clientY - rect.top) / Math.max(1, rect.height) * 2);
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(plane, point)) return active;
      const inCanvas = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      const position: ChoicePoint = [point.x, .65, point.z];
      const next = { ...active, position, targetId: inCanvas ? choicePartyHit(position, latest.current.layout) : null,
        moved: active.moved || Math.hypot(event.clientX - active.startClient[0], event.clientY - active.startClient[1]) > 6 };
      latest.current = { ...latest.current, drag: next };
      return next;
    };
    const move = (event: PointerEvent) => { const next = update(event); if (next) latest.current.onMove(next); };
    const finish = (cancel: boolean, event?: PointerEvent) => {
      if (finished || event && event.pointerId !== pointerId) return;
      finished = true;
      const active = event ? update(event) : latest.current.drag;
      if (active) latest.current.onDrop(active, cancel);
    };
    const up = (event: PointerEvent) => finish(false, event), cancel = (event: PointerEvent) => finish(true, event);
    const blur = () => finish(true);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); finish(true); } };
    try { canvas.setPointerCapture(pointerId); } catch { /* Released or unsupported pointer. */ }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('blur', blur); window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', blur); window.removeEventListener('keydown', key);
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    };
  }, [pointerId, index, camera, gl]);
  return null;
}
