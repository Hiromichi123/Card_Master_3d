import { Color, Group, InstancedMesh, MeshStandardMaterial, Object3D, RingGeometry, Mesh, MeshBasicMaterial, DoubleSide } from 'three';
import { createAsteroidGeometry, createCrystalGeometry } from './vendor/linear-native/assets/ProceduralGeometry.js';
import type { SkillVisualHandle, SkillVisualSpec } from './SkillVisualPool';

export const usesEarthSkill = (template: string): boolean => template === 'skyCollapse' || template === 'earthRift';

/** Cinder Fall's unheated asteroid and Glacial Crown's faceted geometry, without fire or ice shaders. */
export class EarthSkillVisuals {
  readonly group = new Group();
  private readonly rock = createAsteroidGeometry({ detail: 2, seed: 3.7 });
  private readonly pillar = createCrystalGeometry({ seed: 7.4, sides: 6, taper: .46, roughness: .2, bend: .06 });
  private readonly ring = new RingGeometry(.91, 1, 48).rotateX(-Math.PI / 2);

  create(spec: SkillVisualSpec, worldScale: number): SkillVisualHandle {
    const falling = spec.template === 'skyCollapse', scale = Math.max(.2, worldScale);
    const actor = new Group(), dummy = new Object3D();
    actor.name = falling ? '天崩:无火落石' : '地裂:砂岩石柱';
    actor.position.copy(spec.to);
    const seed = Math.random() * 100;
    const random = (i: number, salt: number): number => {
      const n = Math.sin(seed + i * 17.13 + salt * 31.79) * 43758.5453;
      return n - Math.floor(n);
    };
    const material = new MeshStandardMaterial({ color: falling ? '#807362' : '#b28b48',
      roughness: .97, metalness: .02, flatShading: true, transparent: true, depthWrite: true });
    const debrisMaterial = new MeshStandardMaterial({ color: falling ? '#a1957e' : '#d1ad68',
      roughness: 1, flatShading: true, transparent: true });
    const count = falling ? 3 : 11;
    const chunks = new InstancedMesh(falling ? this.rock : this.pillar, material, count);
    const rubbleCount = Math.max(8, Math.min(22, Math.ceil(16 * (spec.countScale ?? 1))));
    const rubble = new InstancedMesh(this.rock, debrisMaterial, rubbleCount);
    chunks.castShadow = chunks.receiveShadow = true;
    const colors = new Color();
    for (let i = 0; i < count; i++) {
      colors.set(falling ? '#877b69' : '#b89651').multiplyScalar(.7 + random(i, 9) * .48);
      chunks.setColorAt(i, colors);
    }
    const rings = new MeshBasicMaterial({ color: falling ? '#c6b59a' : '#c9a14e', transparent: true,
      opacity: 0, side: DoubleSide, depthWrite: false });
    const shock = new Mesh(this.ring, rings);
    shock.position.y = .018 * scale;
    actor.add(chunks, rubble, shock);
    this.group.add(actor);
    let released = false;
    const records = Array.from({ length: count }, (_, i) => {
      const angle = random(i, 1) * Math.PI * 2, radius = i === 0 ? 0 : Math.sqrt(random(i, 2));
      return { x: Math.cos(angle) * radius * .32, z: Math.sin(angle) * radius * .52,
        height: i === 0 ? .92 : .34 + random(i, 3) * .65,
        width: i === 0 ? .31 : .17 + random(i, 4) * .15,
        tiltX: (random(i, 5) - .5) * .42, tiltZ: (random(i, 6) - .5) * .4,
        yaw: angle, delay: falling ? 0 : random(i, 7) * .28 };
    });
    const handle: SkillVisualHandle = {
      update: (phase, progress) => {
        if (released) return;
        const t = Math.max(0, Math.min(1, progress)), travel = phase === 'travel';
        const impacting = phase === 'impact' || phase === 'fade';
        const fade = phase === 'fade' ? 1 - t * t : 1;
        material.opacity = debrisMaterial.opacity = fade;
        chunks.visible = phase !== 'charge' && !(falling && impacting);
        records.forEach((r, i) => {
          const u = impacting ? 1 : travel ? t : 0;
          const grow = Math.max(0, Math.min(1, (u - r.delay) / (1 - r.delay)));
          dummy.rotation.set(falling ? u * (2 + i) : r.tiltX, r.yaw + (falling ? u * 3 : 0), falling ? u * 2 : r.tiltZ);
          if (falling) {
            // All pieces accelerate vertically over the recipient, never launch from the caster.
            dummy.position.set(r.x * scale, (.09 + (1 - u * u) * (3.1 + i * .25)) * scale, r.z * scale);
            dummy.scale.setScalar((i === 0 ? .28 : .13 + random(i, 8) * .06) * scale);
          } else {
            const rise = grow * grow * (3 - 2 * grow);
            dummy.position.set(r.x * scale, (-.15 - (1 - rise) * .22 - (phase === 'fade' ? t * .3 : 0)) * scale, r.z * scale);
            dummy.scale.set(r.width * scale, Math.max(.001, r.height * rise * scale), r.width * scale);
          }
          dummy.updateMatrix(); chunks.setMatrixAt(i, dummy.matrix);
        });
        chunks.instanceMatrix.needsUpdate = true;
        rubble.visible = impacting;
        const age = phase === 'fade' ? .32 + t * .55 : impacting ? t * .32 : 0;
        for (let i = 0; i < rubbleCount; i++) {
          const angle = random(i, 11) * Math.PI * 2, speed = .4 + random(i, 12) * .75;
          const distance = .1 + speed * age;
          dummy.position.set(Math.cos(angle) * distance * scale,
            Math.max(.025, .07 + (.8 + random(i, 13)) * age - 2.2 * age * age) * scale,
            Math.sin(angle) * distance * scale);
          dummy.rotation.set(age * 6 + i, age * 4, i * .7);
          dummy.scale.setScalar((.025 + random(i, 14) * .035) * scale * fade);
          dummy.updateMatrix(); rubble.setMatrixAt(i, dummy.matrix);
        }
        rubble.instanceMatrix.needsUpdate = true;
        shock.visible = impacting;
        shock.scale.setScalar((.18 + age * .82) * scale);
        rings.opacity = impacting ? .28 * fade * Math.max(0, 1 - age) : 0;
      },
      dispose: () => {
        if (released) return;
        released = true; actor.removeFromParent(); chunks.dispose(); rubble.dispose();
        material.dispose(); debrisMaterial.dispose(); rings.dispose();
      },
    };
    actor.traverse(object => { object.frustumCulled = false; object.raycast = () => {}; });
    handle.update('charge', 0);
    return handle;
  }
  dispose(): void { this.rock.dispose(); this.pillar.dispose(); this.ring.dispose(); }
}
