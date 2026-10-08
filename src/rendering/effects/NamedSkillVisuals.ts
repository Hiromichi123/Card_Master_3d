import {
  AdditiveBlending, BufferGeometry, Camera, Color, CylinderGeometry, DataTexture, DoubleSide,
  Group, InstancedBufferAttribute, InstancedMesh, Mesh, MeshBasicMaterial,
  NormalBlending, Object3D, PerspectiveCamera, PlaneGeometry, RGBAFormat, RingGeometry,
  SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Material, type Scene,
} from 'three';
import type { SkillVisualHandle, SkillVisualSpec, VisualPhase } from './SkillVisualPool';
import { createAsteroidGeometry, createBoltRibbonGeometry, createCrystalGeometry } from './vendor/linear-native/assets/ProceduralGeometry.js';
import { createMeteorMaterial } from './vendor/linear-native/materials/MeteorMaterial.js';
import { VolumetricFireMaterial, fireHullReach } from './vendor/linear-native/materials/VolumetricFireMaterial.js';
import { createGlacierMaterial } from './vendor/linear-native/materials/GlacierMaterial.js';
import { createFrostFieldMaterial, createFrostVeilMaterial } from './vendor/linear-native/materials/FrostFieldMaterial.js';
import { BoltPass, createLightningMaterial } from './vendor/linear-native/materials/LightningMaterial.js';
import { RibbonGeometry, RibbonMode } from './vendor/linear-native/effects/RibbonGeometry.js';
import { BurstMode, BurstSystem } from './vendor/linear-native/effects/BurstSphere.js';
import { FissureSystem } from './vendor/linear-native/effects/GroundFissures.js';
import { DecalSystem, DecalType, type GroundDecal } from './vendor/linear-native/effects/GroundDecals.js';
import { frame } from './vendor/linear-native/core/FrameUniforms.js';
import { SnarePass, createSnareCageMaterial, createSnareFieldMaterial } from './vendor/linear-native/materials/SnareMaterial.js';

export function usesLinearAbility(template: string): boolean {
  return ['fireball', 'groupFireball', 'iceSeal', 'groupIceSeal', 'lightning', 'groupLightning', 'curse', 'injury', 'instantDeath'].includes(template);
}

function phaseSeconds(phase: VisualPhase, bolt: boolean, ice: boolean, snare = false): number {
  if (phase === 'charge') return Math.min(0.1, (bolt ? 0.26 : 0.42) * 0.35);
  if (phase === 'travel') return (bolt ? 0.26 : 0.42) - phaseSeconds('charge', bolt, ice, snare);
  if (phase === 'impact') return snare ? 0.38 : ice ? 0.35 : bolt ? 0.22 : 0.28;
  return snare ? 0.60 : ice ? 0.68 : bolt ? 0.35 : 0.48;
}

/** Authored MIT materials/geometry, fitted to one card; the existing skill Timeline remains the clock. */
export class NamedSkillVisuals {
  readonly group = new Group();
  private camera: Camera = new PerspectiveCamera();
  private readonly resolution = new Vector2();
  private scene: Scene | null = null;
  private readonly surfacePoint = new Vector3();
  private readonly depth = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat);
  private readonly environment = new DataTexture(new Uint8Array([178, 202, 228, 255]), 1, 1, RGBAFormat);
  private readonly rock = createAsteroidGeometry({ detail: 2, seed: 3.7 });
  private readonly bolt = createBoltRibbonGeometry(64, 9);
  private readonly snare = createBoltRibbonGeometry(64, 40);
  private readonly plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly veil = new CylinderGeometry(1, 1, 1, 40, 6, true);
  private readonly ring = new RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2);

  constructor() {
    this.group.name = 'LinearAbilityCasting:CinderFall-GlacialCrown-StormLance-VoltaicSnare';
    this.depth.needsUpdate = true;
    this.environment.colorSpace = SRGBColorSpace; this.environment.needsUpdate = true;
    frame.uSceneDepth.value = this.depth;
    frame.uEnvMap.value = this.environment;
  }

  updateFrame(camera: Camera, renderer: WebGLRenderer, delta: number, scene?: Scene): void {
    this.scene = scene ?? this.scene;
    this.camera = camera;
    frame.uTime.value += delta;
    frame.uDelta.value = delta;
    renderer.getDrawingBufferSize(this.resolution);
    frame.uResolution.value.copy(this.resolution);
    frame.uCameraNear.value = 'near' in camera ? Number(camera.near) : 0.1;
    frame.uCameraFar.value = 'far' in camera ? Number(camera.far) : 80;
    frame.uSceneDepth.value = this.depth;
    frame.uEnvMap.value = this.environment;
  }

  private surfaceHeight(point: Vector3, fallback: number, scale: number): number {
    let closest = Math.pow(0.48 * scale, 2);
    let height = fallback;
    this.scene?.traverse((node) => {
      if (!node.userData.cardFaceSurface || !node.visible) return;
      node.updateWorldMatrix(true, false);
      node.getWorldPosition(this.surfacePoint);
      const distance = Math.pow(this.surfacePoint.x - point.x, 2) + Math.pow(this.surfacePoint.z - point.z, 2);
      if (distance < closest) { closest = distance; height = this.surfacePoint.y + 0.02 * scale; }
    });
    return height;
  }

  create(spec: SkillVisualSpec, worldScale: number): SkillVisualHandle {
    const actor = new Group();
    const ice = spec.template === 'iceSeal' || spec.template === 'groupIceSeal';
    const bolt = spec.template === 'lightning' || spec.template === 'groupLightning';
    const injury = spec.template === 'injury';
    const grievous = injury && spec.family === 'grievousWound';
    const instantDeath = spec.template === 'instantDeath';
    const snare = spec.template === 'curse' || injury || instantDeath;
    actor.name = instantDeath ? 'Instant Death:Black Voltaic Snare' : snare ? (injury ? 'Voltaic Snare:Injury-Red-Ground' : 'Voltaic Snare:Curse') : ice ? 'Glacial Crown' : bolt ? 'Storm Lance' : 'Cinder Fall';
    const scale = Math.max(0.2, worldScale);
    const from = spec.from.clone(); const to = spec.to.clone();
    const direction = to.clone().sub(from).setY(0);
    if (direction.lengthSq() < 0.0001) direction.set(0, 0, 1);
    direction.normalize();
    const side = new Vector3().crossVectors(direction, new Vector3(0, 1, 0)).normalize();
    const strength = Math.min(1.5, Math.max(0.8, 1 + spec.intensity * 0.035));
    const materials: Material[] = [];
    const geometries: BufferGeometry[] = [];
    const cleanups: (() => void)[] = [];
    const seed = Math.random() * 12;
    const bursts = new BurstSystem(actor);
    const fissures = !ice && !bolt && !snare ? new FissureSystem(actor) : null;
    cleanups.push(() => bursts.dispose());
    if (fissures) cleanups.push(() => fissures.dispose());
    const dummy = new Object3D();
    let hit = false; let previousPhase: VisualPhase = 'charge'; let previousProgress = 0;
    const floor = to.y + 0.025 * scale;
    const add = <T extends Material>(material: T): T => { materials.push(material); return material; };
    const glow = new Mesh(this.ring, add(new MeshBasicMaterial({ color: ice ? '#c5f7ff' : bolt ? '#a9d6ff' : '#ff963f',
      transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false })));
    glow.position.set(to.x, floor, to.z); actor.add(glow);
    let draw: (phase: VisualPhase, t: number, dt: number) => void;

    if (!ice && !bolt && !snare) {
      const geometry = this.rock.clone(); geometries.push(geometry);
      geometry.setAttribute('aSeed', new InstancedBufferAttribute(new Float32Array(Array.from({ length: 10 }, (_, i) => seed + i * 0.79)), 1));
      geometry.setAttribute('aHeat', new InstancedBufferAttribute(new Float32Array(10).fill(1), 1));
      const material = add(createMeteorMaterial({ registerShadowCasterWithPatch: (m, patch) => {
        m.onBeforeCompile = patch; m.customProgramCacheKey = () => 'native-cinder-fall-rock';
      } }));
      const rocks = new InstancedMesh(geometry, material, 10); rocks.count = 1; actor.add(rocks);
      const ribbon = new RibbonGeometry(26, { frame: true }); cleanups.push(() => ribbon.dispose());
      const flameMaterial = add(new VolumetricFireMaterial());
      // With no sandbox depth prepass, ordinary depth testing keeps the proxy off the table/cards.
      flameMaterial.depthTest = true;
      const flame = new Mesh(ribbon.geometry, flameMaterial); actor.add(flame);
      const path = Array.from({ length: 27 }, () => new Vector3());
      const nose = new Vector3();
      const at = (u: number, out: Vector3): Vector3 => {
        out.lerpVectors(from, to, u);
        out.y += (0.18 + Math.sin(Math.PI * u) * 0.86) * scale;
        return out;
      };
      draw = (phase, t) => {
        const travel = phase === 'travel'; const impacting = phase === 'impact' || phase === 'fade';
        const u = impacting ? 1 : travel ? t : 0;
        material.userData.sync(phase === 'charge' ? t : 1, direction);
        rocks.visible = !impacting && (phase !== 'charge' || t > 0.15);
        at(u, nose);
        if (!impacting) {
          rocks.count = 1;
          dummy.position.copy(nose); dummy.rotation.set(u * 5, u * 8, u * 2);
          dummy.scale.setScalar(0.19 * scale * strength * (phase === 'charge' ? 0.2 + t * 0.8 : 1));
          dummy.updateMatrix(); rocks.setMatrixAt(0, dummy.matrix);
        } else {
          rocks.count = 0;
        }
        rocks.instanceMatrix.needsUpdate = true;
        flame.visible = travel || phase === 'impact';
        if (flame.visible) {
          const tail = Math.max(0, u - 0.4);
          for (let i = 0; i < path.length; i++) at(tail + (u - tail) * i / (path.length - 1), path[i]!);
          const radius = 0.115 * scale * strength * (phase === 'impact' ? 1 - t * 0.8 : 1);
          flameMaterial.sync();
          flameMaterial.uniforms['uRadius']!.value = radius;
          flameMaterial.uniforms['uStreamLength']!.value = Math.max(0.03, path[0]!.distanceTo(path.at(-1)!));
          flameMaterial.uniforms['uArcLength']!.value = flameMaterial.uniforms['uStreamLength']!.value;
          flameMaterial.uniforms['uTailPad']!.value = 0;
          flameMaterial.uniforms['uHeadSize']!.value = 1.9;
          flameMaterial.uniforms['uOpacity']!.value = phase === 'impact' ? 1 - t : 0.9;
          ribbon.build(path, { count: path.length, width: radius * fireHullReach() * 4, mode: RibbonMode.BILLBOARD,
            cameraPosition: this.camera.position });
        }
      };
    } else if (ice) {
      // Glacial Crown's three shapes and rubble skirt, spread across the card instead of a fence.
      const count = 54;
      const slots = count / 3;
      const random = (i: number, salt: number): number => {
        const value = Math.sin((seed + i * 13.37 + salt * 47.11) * 12.9898) * 43758.5453;
        return value - Math.floor(value);
      };
      const records = Array.from({ length: count }, (_, i) => {
        const rubble = i >= 33;
        const tall = i < 12;
        const angle = i * 2.399963 + seed;
        const reach = Math.sqrt(random(i, 1)) * (tall ? 0.78 : 1);
        const x = Math.cos(angle) * reach * 0.43;
        const z = Math.sin(angle) * reach * 0.64;
        return {
          x, z, rubble,
          height: rubble ? 0.06 + random(i, 2) * 0.18 : tall ? 0.58 + random(i, 2) * 0.52 : 0.22 + random(i, 2) * 0.4,
          width: rubble ? 0.075 + random(i, 3) * 0.095 : 0.035 + random(i, 3) * 0.095,
          depth: 0.045 + random(i, 4) * 0.075,
          tiltX: Math.sin(angle + 0.6) * (0.17 + random(i, 5) * (rubble ? 0.7 : 0.52)),
          tiltZ: -Math.cos(angle - 0.45) * (0.14 + random(i, 6) * (rubble ? 0.75 : 0.55)),
          yaw: angle + random(i, 7) * 1.8,
          delay: (z / 0.64 + 1) * 0.13 + random(i, 8) * 0.16 + (rubble ? 0.12 : 0),
          rise: 0.34 + random(i, 9) * 0.28,
          shatterDelay: random(i, 10) * 0.22,
          born: false,
        };
      });
      const crystalMaterial = add(createGlacierMaterial());
      // Detach this box from the vendor's shared frame: reducing ice must not dim fire/lightning.
      crystalMaterial.uniforms['uGlobalGlow'] = { value: 0.85 };
      const variants = Array.from({ length: 3 }, (_, variant) => {
        const geometry = createCrystalGeometry({ seed: 3.9 + variant * 17.3, sides: 5 + variant,
          taper: 0.14 + variant * 0.075, roughness: 0.055 + variant * 0.025, bend: 0.025 + variant * 0.025 });
        geometries.push(geometry);
        const births = new Float32Array(slots).fill(frame.uTime.value);
        const grows = new Float32Array(slots); const shatters = new Float32Array(slots);
        geometry.setAttribute('aSeed', new InstancedBufferAttribute(new Float32Array(Array.from({ length: slots }, (_, i) => seed + (i * 3 + variant) * 0.61)), 1));
        geometry.setAttribute('aBirth', new InstancedBufferAttribute(births, 1));
        geometry.setAttribute('aGrow', new InstancedBufferAttribute(grows, 1));
        geometry.setAttribute('aShatter', new InstancedBufferAttribute(shatters, 1));
        const mesh = new InstancedMesh(geometry, crystalMaterial, slots);
        mesh.visible = false; actor.add(mesh);
        cleanups.push(() => mesh.dispose());
        return { geometry, mesh, births, grows, shatters };
      });
      const fieldMaterial = add(createFrostFieldMaterial());
      fieldMaterial.blending = NormalBlending;
      fieldMaterial.uniforms['uGlobalGlow'] = { value: 0.6 };
      const field = new Mesh(this.plane, fieldMaterial);
      field.position.set(to.x, floor, to.z); field.scale.set(1.12 * scale, 1, 1.68 * scale);
      field.visible = false; actor.add(field);
      const veilMaterial = add(createFrostVeilMaterial());
      veilMaterial.uniforms['uGlobalGlow'] = { value: 0.4 };
      const veils = Array.from({ length: 3 }, (_, i) => {
        const veil = new Mesh(this.veil, veilMaterial);
        const anchor = records[i * 4]!;
        veil.position.set(to.x + anchor.x * scale, floor + 0.06 * scale, to.z + anchor.z * scale);
        veil.scale.set(0.16 * scale, 0.12 * scale, 0.22 * scale); veil.visible = false; actor.add(veil);
        return veil;
      });
      const snow = new DecalSystem(actor); cleanups.push(() => snow.dispose());
      const patches: GroundDecal[] = [];
      let snowStarted = false;
      let snowSurface = floor;
      const trail: { patch: GroundDecal; born: number }[] = [];
      const trailLength = Math.hypot(to.x - from.x, to.z - from.z);
      const trailSteps = Math.min(36, Math.max(2, Math.ceil(trailLength / (0.20 * scale))));
      let nextTrail = 0;
      const trailPoint = new Vector3();
      (glow.material as MeshBasicMaterial).color.set('#9bcbea');
      draw = (phase, t) => {
        const impacting = phase === 'impact' || phase === 'fade';
        const front = phase === 'travel' ? t : impacting ? 1 : 0;
        if (phase !== 'charge') while (nextTrail <= trailSteps && nextTrail / trailSteps <= front) {
          const distance = nextTrail / trailSteps;
          trailPoint.lerpVectors(from, to, distance).setY(0.035 * scale);
          const height = this.surfaceHeight(trailPoint, 0.035 * scale, scale);
          const patch = snow.spawn(DecalType.FROST, trailPoint, { radius: (0.23 + (nextTrail % 3) * 0.025) * scale,
            height: height + 0.004 * scale, life: 3, intensity: 0.9, width: 2,
            colorA: new Color('#b4cbd8'), colorB: new Color('#597f9b') });
          patch.material.uniforms['uGlobalGlow'] = { value: 0.92 };
          patch.mesh.frustumCulled = false; patch.mesh.raycast = () => {};
          trail.push({ patch, born: distance }); nextTrail++;
        }
        const opening = phase === 'impact' ? t * 0.92 : phase === 'fade' ? Math.min(1.2, 0.92 + t * 1.5) : 0;
        const collapse = phase === 'fade' ? Math.max(0, (t - 0.38) / 0.62) : 0;
        const fade = 1 - collapse * collapse;
        for (const variant of variants) variant.mesh.visible = impacting;
        field.visible = impacting;
        for (const veil of veils) veil.visible = impacting;
        crystalMaterial.userData.sync();
        const uniforms = crystalMaterial.uniforms;
        uniforms['uColorGlass']!.value.set('#3985b5');
        uniforms['uColorEdge']!.value.set('#7faac6');
        uniforms['uColorPrismA']!.value.set('#62a4bc');
        uniforms['uColorPrismB']!.value.set('#5681af');
        uniforms['uColorCore']!.value.set('#4a92b6');
        uniforms['uColorTip']!.value.set('#9cc5d7');
        uniforms['uBody']!.value = 0.9;
        uniforms['uEdgeGain']!.value = 0.34;
        uniforms['uEdgePower']!.value = 3.2;
        uniforms['uPipe']!.value = 0.22;
        uniforms['uTipGlow']!.value = 0.24;
        uniforms['uEnvIntensity']!.value = 0.16;
        uniforms['uSpecular']!.value = 0.32;
        uniforms['uBirthGlow']!.value = 0.12;
        uniforms['uFrontGlow']!.value = 0.18;
        uniforms['uShatterGlow']!.value = 0.22;
        uniforms['uDispersion']!.value = 0.25;
        uniforms['uGlow']!.value = 0.62;
        uniforms['uOpacity']!.value = fade * 0.94;
        fieldMaterial.userData.sync({ radius: 0.48 * scale, quadSize: 1.12 * scale,
          freeze: Math.min(1, opening) * (1 - collapse), fade, seed });
        const base = fieldMaterial.uniforms;
        base['uColorField']!.value.set('#648ca9'); base['uColorEdge']!.value.set('#9ab4c4');
        base['uBoundaryGlow']!.value = 0.16; base['uFill']!.value = 0.36;
        base['uSeam']!.value = 0.22; base['uFingers']!.value = 0.18;
        base['uCore']!.value = 0; base['uRings']!.value = 0.4;
        base['uSweep']!.value = 0.035; base['uPulse']!.value = 0.04;
        base['uOpacity']!.value = 0.65;
        veilMaterial.userData.sync({ fade: Math.min(1, opening) * fade, seed });
        veilMaterial.uniforms['uOpacity']!.value = 0.10;
        veilMaterial.uniforms['uColorVeil']!.value.set('#5689a6');
        veilMaterial.uniforms['uColorCrest']!.value.set('#87aabd');
        if (impacting && !snowStarted) {
          snowStarted = true;
          snowSurface = this.surfaceHeight(to, floor + 0.08 * scale, scale);
          field.position.y = snowSurface;
          for (const veil of veils) veil.position.y = snowSurface + 0.06 * scale;
          // Original frost decal shades noisy snow relief with the scene light, rather than a luminous disc.
          for (let i = 0; i < 7; i++) {
            const anchor = records[33 + i * 3]!;
            const position = i === 0 ? to.clone() : new Vector3(to.x + anchor.x * scale, floor, to.z + anchor.z * scale);
            const patch = snow.spawn(DecalType.FROST, position, { radius: (i === 0 ? 0.44 : 0.15 + random(i, 11) * 0.07) * scale,
              height: snowSurface + 0.008 * scale + i * 0.0004 * scale, life: 3, intensity: 0.72,
              width: 1.8, colorA: new Color('#a7bac9'), colorB: new Color('#50728e') });
            if (i === 0) { patch.mesh.rotation.y = 0; patch.mesh.scale.x *= 0.95; patch.mesh.scale.z *= 1.45; }
            patch.material.uniforms['uGlobalGlow'] = { value: 0.85 };
            patch.mesh.frustumCulled = false; patch.mesh.raycast = () => {};
            patches.push(patch);
          }
        }
        for (const patch of patches) patch.material.uniforms['uAge']!.value = Math.min(1, 0.30 * Math.min(1, opening) + collapse * 0.70);
        for (const item of trail) {
          const age = phase === 'travel' ? Math.min(0.34, Math.max(0.025, (front - item.born) * 1.6)) : 0.34 + collapse * 0.66;
          item.patch.material.uniforms['uAge']!.value = age;
        }
        for (let i = 0; i < count; i++) {
          const record = records[i]!;
          const variant = variants[i % 3]!; const slot = Math.floor(i / 3);
          const growth = Math.min(1, Math.max(0, (opening - record.delay) / record.rise));
          if (growth > 0 && !record.born) { record.born = true; variant.births[slot] = frame.uTime.value; }
          const rise = 1 - Math.pow(1 - growth, 3);
          const shatter = Math.min(1, Math.max(0, (collapse - record.shatterDelay) / (1 - record.shatterDelay)));
          variant.grows[slot] = rise; variant.shatters[slot] = shatter;
          dummy.position.set(to.x + record.x * scale, floor - shatter * (record.rubble ? 0.06 : 0.22) * scale,
            to.z + record.z * scale);
          dummy.rotation.set(record.tiltX + shatter * 0.17, record.yaw, record.tiltZ - shatter * 0.11);
          dummy.scale.set(record.width * scale, record.height * scale * Math.max(0.001, rise), record.depth * scale);
          dummy.updateMatrix(); variant.mesh.setMatrixAt(slot, dummy.matrix);
        }
        for (const variant of variants) {
          for (const attribute of ['aBirth', 'aGrow', 'aShatter']) variant.geometry.getAttribute(attribute).needsUpdate = true;
          variant.mesh.instanceMatrix.needsUpdate = true;
        }
        glow.visible = phase === 'travel';
        if (phase === 'travel') {
          const frontHeight = this.surfaceHeight(glow.position.copy(from).lerp(to, t), 0.055 * scale, scale);
          glow.position.y = frontHeight + 0.012 * scale;
          glow.scale.set(0.48 * scale, 1, 0.48 * scale);
          (glow.material as MeshBasicMaterial).opacity = 0.72;
        }
      };
    } else if (snare) {
      const geometry = this.snare.clone(); geometries.push(geometry);
      const core = add(createSnareCageMaterial(SnarePass.CORE));
      const halo = add(createSnareCageMaterial(SnarePass.GLOW));
      const coreMesh = new Mesh(geometry, core); const haloMesh = new Mesh(geometry, halo);
      haloMesh.renderOrder = 11; coreMesh.renderOrder = 13;
      actor.add(haloMesh, coreMesh);
      const fieldMaterial = add(createSnareFieldMaterial());
      const field = new Mesh(this.plane, fieldMaterial);
      if (grievous) field.renderOrder = 14; // Keep the spell visible above the dark persistent face mask.
      field.position.set(to.x, floor + 0.006 * scale, to.z);
      field.visible = false; actor.add(field);
      for (const material of [core, halo, fieldMaterial]) {
        material.uniforms['uGlobalGlow'] = { value: injury ? 0.72 : 0.85 };
        // A black curse must subtract/occlude light; additive black would be invisible.
        if (instantDeath) material.blending = NormalBlending;
      }
      const centre = to.clone().setY(floor);
      const hand = from.clone(); const front = new Vector3();
      const radius = 0.64 * scale;
      draw = (phase, t) => {
        const surfaceFloor = grievous
          ? this.surfaceHeight(to, to.y + 0.02 * scale, scale) - 0.02 * scale + 0.004 * scale : floor;
        centre.y = surfaceFloor;
        field.position.y = surfaceFloor + (grievous ? 0.002 : 0.006) * scale;
        const travelling = phase === 'travel';
        const impacting = phase === 'impact' || phase === 'fade';
        const open = phase === 'impact' ? 1 - Math.pow(1 - t, 3) : phase === 'fade' ? 1 : 0;
        const fade = phase === 'fade' ? 1 - t * t : 1;
        front.lerpVectors(from, to, travelling ? t : 1).setY(surfaceFloor + 0.02 * scale);
        const counts = {
          leash: travelling && !injury ? 3 : 0,
          column: impacting && !injury ? 8 : 0,
          tendril: impacting ? 12 : 0,
          rim: impacting ? 8 : 0,
        };
        const filaments = counts.leash + counts.column + counts.tendril + counts.rim;
        geometry.instanceCount = Math.max(1, filaments);
        coreMesh.visible = haloMesh.visible = filaments > 0;
        for (const material of [core, halo]) {
          material.userData.sync({ centre, hand, front, radius: Math.max(0.025, radius * open),
            height: injury ? 0.025 * scale : 1.25 * scale * open, fade, seed, counts });
          const u = material.uniforms;
          u['uWidth']!.value *= 0.64 * scale;
          u['uLeashSag']!.value *= 0.3 * scale;
          u['uLeashCling']!.value = surfaceFloor + 0.01 * scale;
          u['uLeashSpread']!.value *= 0.3 * scale;
          u['uLeashKink']!.value *= 0.3 * scale;
          u['uColumnKink']!.value *= 0.35 * scale;
          u['uTendrilHug']!.value = surfaceFloor + 0.014 * scale;
          u['uTendrilArch']!.value = (injury ? 0.035 : 0.11) * scale;
          u['uTendrilKink']!.value *= (injury ? 0.16 : 0.35) * scale;
          u['uRimHeight']!.value = (injury ? 0.045 : 0.18) * scale;
          u['uRimKink']!.value *= (injury ? 0.16 : 0.35) * scale;
          u['uOpacity']!.value *= injury ? 0.82 : 0.9;
          if (injury) {
            // Retire the COLUMN role entirely: no vertical pillar or updraft is created.
            u['uCountColumn']!.value = 0;
            u['uColorCore']!.value.set('#ffb9ac'); u['uColorInner']!.value.set('#ff7467');
            u['uColorOuter']!.value.copy(spec.tint ?? new Color('#e82d48')); u['uColorHalo']!.value.copy(spec.tint?.clone().multiplyScalar(.4) ?? new Color('#8b102b'));
            if (spec.tint) { u['uColorCore']!.value.copy(spec.tint.clone().multiplyScalar(1.35)); u['uColorInner']!.value.copy(spec.tint); }
            u['uGlow']!.value = 0.6;
          }
          if (instantDeath) {
            u['uColorCore']!.value.set('#1d1726'); u['uColorInner']!.value.set('#100c17');
            u['uColorOuter']!.value.set('#050408'); u['uColorHalo']!.value.set('#08060c');
            u['uGlow']!.value = 0.7; u['uOpacity']!.value = 0.95;
          }
        }
        field.visible = impacting;
        field.scale.set((radius + 0.2 * scale) * 2, 1, (radius + 0.2 * scale) * 2);
        fieldMaterial.userData.sync({ radius: Math.max(0.025, radius * open), quadSize: (radius + 0.2 * scale) * 2, fade, seed });
        const u = fieldMaterial.uniforms;
        u['uBoundary']!.value = 0.085 * scale;
        u['uCore']!.value = injury ? 0.10 : 0.35;
        u['uBoundaryGlow']!.value = grievous ? 0.95 : injury ? 0.7 : 0.9;
        u['uOpacity']!.value *= grievous ? 0.95 : injury ? 0.7 : 0.85;
        if (injury) {
          u['uColorField']!.value.copy(spec.tint ?? new Color('#ba253d')); u['uColorEdge']!.value.copy(spec.tint?.clone().multiplyScalar(1.4) ?? new Color('#f57866'));
          u['uPulse']!.value = 0.12;
        }
        if (instantDeath) {
          u['uColorField']!.value.set('#09060e'); u['uColorEdge']!.value.set('#21172f');
          u['uOpacity']!.value = 0.94;
        }
        glow.visible = false;
      };
    } else {
      const core = add(createLightningMaterial(BoltPass.CORE)); const halo = add(createLightningMaterial(BoltPass.GLOW));
      const coreMesh = new Mesh(this.bolt, core); const haloMesh = new Mesh(this.bolt, halo);
      actor.add(haloMesh, coreMesh);
      const origin = from.clone().add(new Vector3(0, 0.14 * scale, 0));
      const target = to.clone().add(new Vector3(0, 0.16 * scale, 0));
      draw = (phase, t) => {
        const active = phase !== 'charge';
        const fade = phase === 'fade' ? 1 - t * t * t : active ? 1 : 0;
        coreMesh.visible = haloMesh.visible = active;
        for (const material of [core, halo]) {
          material.userData.sync({ origin, target, side, seed, strands: 9, progress: phase === 'travel' ? Math.min(1, t * 1.6) : 1, fade });
          material.uniforms['uSpread']!.value *= 0.38 * scale;
          material.uniforms['uSpreadNear']!.value *= 0.38 * scale;
          material.uniforms['uJitter']!.value *= 0.42 * scale;
          material.uniforms['uWidth']!.value *= scale;
          material.uniforms['uSag']!.value *= scale;
        }
      };
    }

    this.group.add(actor);
    let released = false;
    const handle: SkillVisualHandle = {
      update: (phase, progress) => {
        if (released) return;
        const t = Math.min(1, Math.max(0, progress));
        const dt = phase === previousPhase ? Math.max(0, t - previousProgress) * phaseSeconds(phase, bolt, ice, snare) : t * phaseSeconds(phase, bolt, ice, snare);
        previousPhase = phase; previousProgress = t;
        const impacting = phase === 'impact' || phase === 'fade';
        if (impacting && !hit && !snare) {
          hit = true;
          const position = to.clone().setY(floor + 0.12 * scale);
          bursts.spawn(ice ? BurstMode.FROST : bolt ? BurstMode.STORM : BurstMode.FIRE, position,
            { radius: 0.08 * scale, endRadius: (ice ? 0.66 : bolt ? 0.45 : 0.85) * scale * strength,
              life: 0.45, intensity: ice ? 0.16 : 1.2, opacity: ice ? 0.055 : 0.9, squash: ice ? 0.35 : 0.75 });
          const crater = fissures?.spawn(to.clone().setY(floor), { radius: 0.65 * scale, life: 0.9, height: floor });
          if (crater) crater.lips.visible = false;
        }
        bursts.update(dt); fissures?.update(dt);
        const fade = phase === 'fade' ? 1 - t : 1;
        glow.position.y = floor;
        if (impacting) glow.position.set(to.x, floor, to.z);
        glow.visible = impacting || (ice && phase === 'travel');
        (glow.material as MeshBasicMaterial).opacity = impacting ? fade * (ice ? 0.10 : 0.5) : ice && phase === 'travel' ? 0.15 : 0;
        glow.scale.set((0.32 + (impacting ? 0.5 * t : 0)) * scale, 1, (0.32 + (impacting ? 0.5 * t : 0)) * scale);
        draw(phase, t, dt);
      },
      dispose: () => {
        if (released) return; released = true;
        actor.removeFromParent();
        for (const cleanup of cleanups) cleanup();
        for (const material of materials) material.dispose();
        for (const geometry of geometries) geometry.dispose();
      },
    };
    actor.traverse((object) => { object.frustumCulled = false; object.raycast = () => {}; });
    handle.update('charge', 0);
    return handle;
  }

  dispose(): void {
    this.rock.dispose(); this.bolt.dispose(); this.snare.dispose(); this.plane.dispose(); this.veil.dispose(); this.ring.dispose();
    this.depth.dispose(); this.environment.dispose();
    this.scene = null;
    if (frame.uSceneDepth.value === this.depth) frame.uSceneDepth.value = null;
    if (frame.uEnvMap.value === this.environment) frame.uEnvMap.value = null;
  }
}
