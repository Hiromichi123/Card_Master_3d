import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box3, Frustum, Matrix4, PlaneGeometry, Vector3, type Mesh, type ShaderMaterial } from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { MeshReflectorMaterial } from '@react-three/drei/materials/MeshReflectorMaterial.js';

/** Same Drei surface shader; Three's MIT Reflector supplies the projection and clipping math.
 * Offscreen mirrors do not render. Stationary-camera reflections refresh at 20 Hz, staggered;
 * camera movement refreshes immediately to keep reflected geometry attached to the room.
 */
export function RoomMirrorMaterial({ resolution, mirror, mixStrength, color, roughness, index }: {
  readonly resolution: number; readonly mirror: number; readonly mixStrength: number;
  readonly color: string; readonly roughness: number; readonly index: number;
}) {
  const attached = useRef<MeshReflectorMaterial>(null);
  const resources = useMemo(() => {
    const geometry = new PlaneGeometry(1, 1);
    const probe = new Reflector(geometry, { textureWidth: resolution, textureHeight: resolution, multisample: 0 });
    const material = new MeshReflectorMaterial({ color, roughness, metalness: 0 });
    material.textureMatrix = (probe.material as ShaderMaterial).uniforms['textureMatrix']!.value as Matrix4;
    material.tDiffuse = probe.getRenderTarget().texture;
    material.mirror = mirror; material.mixStrength = mixStrength;
    material.mixContrast = mirror === 1 ? 1.08 : 1;
    material.hasBlur = false; material.mixBlur = 0; material.depthScale = 0;
    return { probe, geometry, material, bounds: new Box3(), frustum: new Frustum(), projection: new Matrix4(),
      lastCamera: new Matrix4(), lastProjection: new Matrix4(), normal: new Vector3(), view: new Vector3(), last: -Infinity };
  }, [resolution, mirror, mixStrength, color, roughness]);
  useEffect(() => () => {
    resources.probe.dispose(); resources.geometry.dispose(); resources.material.dispose();
  }, [resources]);
  useFrame(({ gl, scene, camera, clock }) => {
    const material = attached.current;
    // Fiber owns the material attachment; use its real parent mesh, never a scene traversal.
    const parent = (material as unknown as { __r3f?: { parent?: { object?: Mesh } } })?.__r3f?.parent?.object;
    if (!parent || !parent.visible) return;
    parent.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    resources.normal.set(0, 0, 1).transformDirection(parent.matrixWorld);
    resources.view.setFromMatrixPosition(parent.matrixWorld).sub(camera.position);
    if (resources.view.dot(resources.normal) > 0) return;
    resources.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    resources.frustum.setFromProjectionMatrix(resources.projection);
    if (!parent.geometry.boundingBox) parent.geometry.computeBoundingBox();
    resources.bounds.copy(parent.geometry.boundingBox!).applyMatrix4(parent.matrixWorld);
    if (!resources.frustum.intersectsBox(resources.bounds)) return;
    const moving = !resources.lastCamera.equals(camera.matrixWorld) || !resources.lastProjection.equals(camera.projectionMatrix);
    const slot = Math.floor(clock.elapsedTime * 20 + index / 5);
    if (!moving && slot === resources.last) return;
    resources.last = slot;
    resources.lastCamera.copy(camera.matrixWorld); resources.lastProjection.copy(camera.projectionMatrix);
    const wasVisible = parent.visible;
    parent.visible = false;
    resources.probe.matrixWorld.copy(parent.matrixWorld);
    const target = gl.getRenderTarget(), xr = gl.xr.enabled, shadow = gl.shadowMap.autoUpdate;
    try {
      resources.probe.onBeforeRender(gl, scene, camera, parent.geometry, resources.probe.material as ShaderMaterial, null!);
    } finally {
      parent.visible = wasVisible; gl.xr.enabled = xr; gl.shadowMap.autoUpdate = shadow; gl.setRenderTarget(target);
    }
  });
  return <primitive ref={attached} object={resources.material} attach="material" dispose={null} />;
}
