import {
  AdditiveBlending, Color, DoubleSide, Float32BufferAttribute,
  Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  RingGeometry, ShaderMaterial, SphereGeometry, TextureLoader, Vector3,
  type Material, type Texture,
} from 'three';
import type { EffectTemplateId } from './familyMap';
import { createCrystalGeometry } from './vendor/linearCrystal';
import { LINEAR_BOLT_FRAGMENT, LINEAR_BOLT_VERTEX } from './vendor/linearShaders';

export type VisualPhase = 'charge' | 'travel' | 'impact' | 'fade';
export interface SkillVisualSpec {
  readonly template: EffectTemplateId;
  readonly family?: string | undefined;
  readonly from: Vector3;
  readonly to: Vector3;
  readonly intensity: number;
  readonly tint?: Color | undefined;
}
export interface SkillVisualHandle {
  update(phase: VisualPhase, progress: number): void;
  dispose(): void;
}
export interface SkillVisualFactory {
  create(spec: SkillVisualSpec): SkillVisualHandle;
}

const TAU = Math.PI * 2;
const COLORS = {
  fire: '#ff7025', ice: '#78dfff', bolt: '#9acaff', shield: '#5dbbff',
  heal: '#65ffc0', buff: '#ffe09a', curse: '#b174ff', blood: '#ff3e70', flow: '#9cbaff',
};
const SPRITE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    center.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
    gl_Position = projectionMatrix * center;
  }
`;
const SPRITE_FRAGMENT = `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFrame;
  uniform float uGrid;
  varying vec2 vUv;
  void main() {
    float frame = mod(floor(uFrame), uGrid * uGrid);
    vec2 cell = vec2(mod(frame, uGrid), uGrid - 1.0 - floor(frame / uGrid));
    vec4 texel = texture2D(uMap, (vUv + cell) / uGrid);
    float mask = max(texel.r, max(texel.g, texel.b));
    if (mask < 0.025) discard;
    gl_FragColor = vec4(texel.rgb * uColor, mask * uOpacity);
  }
`;

function boltGeometry(): InstancedBufferGeometry {
  // The (t, side) ribbon layout matches the MIT source vertex shader.
  const segments = 48;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    positions.push(i / segments, -1, 0, i / segments, 1, 0);
    if (i < segments) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aStrand', new InstancedBufferAttribute(new Float32Array([0, 1, 2]), 1));
  geometry.setIndex(indices);
  geometry.instanceCount = 3;
  return geometry;
}

function boltMaterial(spec: SkillVisualSpec, glow: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: LINEAR_BOLT_VERTEX, fragmentShader: LINEAR_BOLT_FRAGMENT,
    defines: glow ? { BOLT_GLOW: '' } : {},
    transparent: true, depthWrite: false, side: DoubleSide,
    blending: AdditiveBlending, toneMapped: false,
    uniforms: {
      uTime: { value: 0 }, uOrigin: { value: spec.from.clone() }, uTarget: { value: spec.to.clone() },
      uSide: { value: new Vector3(1, 0, 0) }, uSag: { value: 0.1 }, uSeed: { value: Math.random() * 99 },
      uRestrike: { value: 22 }, uStrands: { value: 3 }, uSpread: { value: 0.13 },
      uSpreadNear: { value: 0 }, uSpreadCurve: { value: 1.6 }, uTwist: { value: 0.3 },
      uTwistSpeed: { value: 0.8 }, uJitter: { value: 0.16 }, uJitterScale: { value: 1.2 },
      uOctaves: { value: 3 }, uJitterFalloff: { value: 0.5 }, uCrawl: { value: 2 },
      uPinch: { value: 0.12 }, uConverge: { value: 1 }, uWidth: { value: 0.024 },
      uWidthTip: { value: 0.7 }, uWidthCurve: { value: 1 }, uCoreWidth: { value: 1.5 },
      uWidthScale: { value: glow ? 5 : 1 }, uStrandFlash: { value: 0.25 },
      uFlickerSpeed: { value: 30 }, uFade: { value: 0 }, uProgress: { value: 0 },
      uTipGlow: { value: 0.35 }, uTipLength: { value: 0.05 }, uCoreSharp: { value: 1.5 },
      uGlowFalloff: { value: 2 }, uBranchDim: { value: 0.6 }, uFlicker: { value: 0.15 },
      uPassOpacity: { value: glow ? 0.18 : 0.85 }, uOpacity: { value: 1 },
      uGlow: { value: 1 }, uGlobalGlow: { value: 1 },
      uColorCore: { value: new Color('#edfaff') }, uColorInner: { value: new Color('#a8ddff') },
      uColorOuter: { value: spec.tint?.clone() ?? new Color('#519eff') }, uColorHalo: { value: spec.tint?.clone().multiplyScalar(0.4) ?? new Color('#3152ff') },
    },
  });
}

/** Shared geometry/textures, bounded live actors. No rule callbacks or independent clock. */
export class SkillVisualPool implements SkillVisualFactory {
  readonly group = new Group();
  worldScale = 1;
  private readonly geometries = {
    ring: new RingGeometry(0.975, 1, 48), plane: new PlaneGeometry(1, 1),
    sphere: new SphereGeometry(1, 12, 8), rock: new IcosahedronGeometry(1, 1),
    crystal: createCrystalGeometry({ sides: 5, bend: 0.12, roughness: 0.25 }), bolt: boltGeometry(),
  };
  private readonly active = new Set<SkillVisualHandle>();
  private readonly textures = new Map<string, Texture>();

  constructor(readonly maxActors = 24) { this.group.name = 'battle-skill-geometry'; }
  get activeCount(): number { return this.active.size; }
  get geometryCount(): number { return Object.keys(this.geometries).length; }

  private texture(name: string): Texture | null {
    const existing = this.textures.get(name);
    if (existing) return existing;
    // Unit tests create the pool without a browser; geometry still works without sprite maps.
    if (typeof document === 'undefined') return null;
    const texture = new TextureLoader().load(`${import.meta.env.BASE_URL}assets/vfx/${name.includes('.') ? name : name + '.png'}`);
    this.textures.set(name, texture);
    return texture;
  }

  create(spec: SkillVisualSpec): SkillVisualHandle {
    while (this.active.size >= this.maxActors) this.active.values().next().value?.dispose();
    const actor = new Group();
    actor.name = `skill-${spec.template}`;
    const materials: Material[] = [];
    const visualTime = { value: 0 };
    const intensity = Math.min(3, Math.max(0.6, 1 + spec.intensity * 0.12));
    const scale = this.worldScale;
    const template = spec.template;
    const fire = ['fireball', 'groupFireball', 'bombard', 'deathBurst'].includes(template);
    const ice = template === 'iceSeal' || template === 'groupIceSeal';
    const bolt = template === 'lightning' || template === 'groupLightning';
    const healing = template === 'heal' || template === 'groupHeal';
    const blood = template === 'lifeDrain';
    const color = spec.tint?.clone() ?? new Color(fire ? COLORS.fire : ice ? COLORS.ice : bolt ? COLORS.bolt :
      healing ? COLORS.heal : blood ? COLORS.blood : template === 'buff' ? COLORS.buff :
      template === 'debuff' || template === 'silence' || spec.family === 'delay' ? COLORS.curse :
      template === 'shield' || template === 'armorBreak' ? COLORS.shield : COLORS.flow);
    const basic = (opacity = 1, wireframe = false): MeshBasicMaterial => {
      const material = new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false,
        blending: AdditiveBlending, side: DoubleSide, toneMapped: false, wireframe });
      materials.push(material); return material;
    };
    const ringMaterial = basic(0);
    const ring = new Mesh(this.geometries.ring, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(spec.to); ring.position.y += 0.055;
    actor.add(ring);
    const circleMap = this.texture('magic-circle');
    const sigilMaterial = basic(0);
    if (circleMap) sigilMaterial.map = circleMap;
    const sigil = new Mesh(this.geometries.plane, sigilMaterial);
    sigil.rotation.x = -Math.PI / 2;
    sigil.position.copy(spec.to); sigil.position.y += 0.045;
    sigil.visible = healing || ['buff', 'debuff', 'rebirth', 'cooldown', 'silence', 'flyingDeploy'].includes(template);
    actor.add(sigil);

    const coreMaterial = basic(0);
    const core = new Mesh(fire ? this.geometries.rock : this.geometries.sphere, coreMaterial);
    core.position.copy(spec.from); actor.add(core);
    const impactMaterial = basic(0, true);
    const impact = new Mesh(this.geometries.sphere, impactMaterial);
    impact.position.copy(spec.to); actor.add(impact);

    let flame: Mesh<PlaneGeometry, ShaderMaterial> | undefined;
    if (fire) {
      const flameMap = this.texture('flame-atlas');
      if (flameMap) {
        const material = new ShaderMaterial({ vertexShader: SPRITE_VERTEX, fragmentShader: SPRITE_FRAGMENT,
          uniforms: { uMap: { value: flameMap }, uColor: { value: new Color(1, 0.95, 0.8) },
            uOpacity: { value: 0 }, uFrame: visualTime, uGrid: { value: 4 } },
          transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
        materials.push(material); flame = new Mesh(this.geometries.plane, material); actor.add(flame);
      }
    }
    const bolts: Mesh<InstancedBufferGeometry, ShaderMaterial>[] = [];
    if (bolt) for (const glow of [true, false]) {
      const material = boltMaterial(spec, glow); materials.push(material);
      const mesh = new Mesh(this.geometries.bolt, material); mesh.frustumCulled = false;
      bolts.push(mesh); actor.add(mesh);
    }
    const crystals: Mesh[] = [];
    let iceMaterial: MeshStandardMaterial | undefined;
    if (ice) {
      iceMaterial = new MeshStandardMaterial({ color, emissive: '#194650', emissiveIntensity: 0.4,
        roughness: 0.2, metalness: 0.18, flatShading: true, transparent: true, opacity: 0.85 });
      iceMaterial.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vIceLocal;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIceLocal = position;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vIceLocal;')
          .replace('#include <color_fragment>', `#include <color_fragment>
            float vein = pow(1.0 - abs(sin(vIceLocal.y * 27.0 + sin(vIceLocal.x * 31.0 + vIceLocal.z * 19.0))), 12.0);
            float rime = pow(1.0 - clamp(vIceLocal.y, 0.0, 1.0), 4.0);
            diffuseColor.rgb = mix(diffuseColor.rgb * 0.7, vec3(0.65, 0.92, 1.0), vein * 0.55 + rime * 0.2);`);
      };
      iceMaterial.customProgramCacheKey = () => 'battle-ice-veins-v1';
      materials.push(iceMaterial);
      for (let i = 0; i < 7; i += 1) {
        const crystal = new Mesh(this.geometries.crystal, iceMaterial);
        const angle = i * TAU / 7;
        crystal.position.copy(spec.to).add(new Vector3(Math.cos(angle) * 0.38 * scale, 0, Math.sin(angle) * 0.48 * scale));
        crystal.rotation.set(Math.sin(angle) * 0.28, angle, -Math.cos(angle) * 0.28);
        crystal.scale.setScalar(0); crystals.push(crystal); actor.add(crystal);
      }
    }
    const ghostMaterial = basic(0);
    if (template === 'clone' || template === 'rebirth' || template === 'dodge') ghostMaterial.map = this.texture('card-back.webp');
    const ghosts: Mesh[] = [];
    if (template === 'clone' || template === 'dodge' || template === 'rebirth') for (let i = 0; i < 3; i += 1) {
      const ghost = new Mesh(this.geometries.plane, ghostMaterial); ghost.rotation.x = -Math.PI / 2;
      ghost.position.copy(spec.to); ghosts.push(ghost); actor.add(ghost);
    }
    const barMaterial = basic(0);
    const bars: Mesh[] = [];
    if (healing || template === 'silence' || template === 'cooldown' || template === 'buff') {
      const a = new Mesh(this.geometries.plane, barMaterial);
      const b = new Mesh(this.geometries.plane, barMaterial);
      a.position.copy(spec.to).add(new Vector3(0, 0.7 * scale, 0)); b.position.copy(a.position);
      a.scale.set(0.32 * scale, 0.08 * scale, 1); b.scale.set(0.08 * scale, 0.32 * scale, 1);
      if (template === 'silence') { a.rotation.z = 0.65; b.rotation.z = 0.65; }
      bars.push(a, b); actor.add(a, b);
    }
    this.group.add(actor);
    let released = false;
    const handle: SkillVisualHandle = {
      update: (phase, t) => {
        if (released) return;
        const travel = phase === 'travel';
        const hit = phase === 'impact' || phase === 'fade';
        const fade = phase === 'fade' ? 1 - t : 1;
        const grow = phase === 'impact' ? Math.min(1, t * 3) : phase === 'fade' ? 1 : 0;
        visualTime.value = (phase === 'charge' ? t : phase === 'travel' ? 1 + t : 2 + t) * 12;
        core.visible = !hit && template !== 'flyingDeploy';
        coreMaterial.opacity = (phase === 'charge' ? t * 0.65 : 0.85) * (fire ? 0.35 : 1);
        const bodySize = (fire ? 0.16 : 0.07) * intensity * scale;
        core.scale.setScalar(bodySize * (phase === 'charge' ? 0.25 + t * 0.75 : 1));
        core.position.lerpVectors(spec.from, spec.to, travel ? t : 0);
        if (travel && !bolt) core.position.y += Math.sin(t * Math.PI) * (fire ? 0.8 : 0.35) * scale;
        core.rotation.set(t * 3, t * 6, 0);
        if (blood) core.position.lerpVectors(spec.to, spec.from, travel ? t : 0);
        if (flame) {
          flame.visible = !hit || (hit && fire);
          flame.position.copy(hit ? spec.to : core.position); flame.position.y += 0.12 * scale;
          flame.scale.setScalar((hit ? 0.6 + grow * 0.8 : 0.65) * intensity * scale);
          flame.material.uniforms['uOpacity']!.value = hit ? fade * 0.7 : coreMaterial.opacity;
        }
        for (const mesh of bolts) {
          mesh.visible = travel || phase === 'impact';
          mesh.material.uniforms['uTime']!.value = visualTime.value * 0.08;
          mesh.material.uniforms['uProgress']!.value = travel ? Math.min(1, t * 3) : 1;
          mesh.material.uniforms['uFade']!.value = travel ? 1 : phase === 'impact' ? 1 - t : 0;
        }
        ring.visible = hit || (phase === 'charge' && !fire && !bolt && !ice);
        ringMaterial.opacity = hit ? fade * (1 - (phase === 'impact' ? t * 0.4 : 0)) * 0.75 : t * 0.25;
        ring.scale.setScalar((0.15 + (hit ? 0.42 + t * 0.22 : t * 0.35)) * scale);
        impact.visible = hit && ['shield', 'armorBreak', 'deathBurst'].includes(template);
        impactMaterial.opacity = template === 'armorBreak' ? fade * 0.6 : hit ? fade * 0.32 : 0;
        impact.scale.setScalar((template === 'shield' ? 0.65 : 0.14 + grow * 0.48 + t * 0.18) * scale);
        if (template === 'armorBreak') { impact.rotation.set(t * 1.5, t * 3, t); impact.scale.y *= Math.max(0.1, 1 - t); }
        sigilMaterial.opacity = hit ? fade * 0.75 : phase === 'charge' ? t * 0.25 : 0.4;
        sigil.scale.setScalar((0.85 + grow * 0.65) * scale); sigil.rotation.z = t * 0.35;
        if (iceMaterial) iceMaterial.opacity = fade * 0.88;
        crystals.forEach((crystal, i) => {
          const rise = hit ? Math.max(0, Math.min(1, (grow - i * 0.025) * 1.3)) : 0;
          crystal.scale.set(0.2 * scale, (0.5 + i % 3 * 0.2) * rise * scale, 0.22 * scale);
          if (phase === 'fade') crystal.position.y = spec.to.y - t * t * 0.45 * scale;
        });
        ghostMaterial.opacity = hit ? fade * 0.45 : 0;
        ghosts.forEach((ghost, i) => {
          ghost.scale.set(0.75 * scale, 1.1 * scale, 1);
          ghost.position.x = spec.to.x + (i - 1) * t * (template === 'dodge' ? 0.85 : 0.45) * scale;
          ghost.position.y = spec.to.y + 0.15 + (template === 'rebirth' ? grow * 0.55 : 0);
        });
        barMaterial.opacity = hit ? fade * 0.8 : 0;
        bars.forEach((bar, i) => { bar.position.y = spec.to.y + (0.55 + (hit ? t * 0.5 : 0)) * scale;
          if (template === 'cooldown') bar.rotation.z = t * TAU * (i === 0 ? 1 : -0.5); });
      },
      dispose: () => {
        if (released) return;
        released = true; actor.removeFromParent();
        for (const material of materials) material.dispose();
        this.active.delete(handle);
      },
    };
    actor.traverse((object) => { object.frustumCulled = false; object.raycast = () => {}; });
    handle.update('charge', 0);
    this.active.add(handle);
    return handle;
  }

  clear(): void { for (const actor of [...this.active]) actor.dispose(); }
  dispose(): void {
    this.clear();
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }
}
