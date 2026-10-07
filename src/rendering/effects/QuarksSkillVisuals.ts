import {
  AdditiveBlending, DoubleSide, Group, MeshBasicMaterial, NormalBlending,
  SRGBColorSpace, TextureLoader, Vector3, type Material, type Texture,
} from 'three';
import {
  BatchedRenderer, Bezier, ColorOverLife, ColorRange, ConstantColor, ConstantValue,
  FrameOverLife, Gradient, GridEmitter, IntervalValue, ParticleSystem, PiecewiseBezier,
  PointEmitter, RenderMode, RotationOverLife, SizeOverLife, SphereEmitter,
  Vector4, Vector3 as QuarksVector3,
  type Behavior, type Particle, type ParticleSystemParameters, TrailParticle, RecordState,
} from 'three.quarks';
import { ANIMATION_DURATION_SCALE } from '../anim/timing';
import { PIERCING_END_EXTENSION } from './artilleryTiming';
import type { SkillVisualHandle, SkillVisualSpec } from './SkillVisualPool';

export function usesQuarks(template: string): boolean {
  return ['bombard', 'groupBombard', 'deathBurst', 'deathBombard', 'ranged', 'piercing', 'groupPiercing'].includes(template);
}

const curve = (a: number, b: number, c: number, d: number): PiecewiseBezier =>
  new PiecewiseBezier([[new Bezier(a, b, c, d), 0]]);

/**
 * `ColorOverLife` takes a function generator (it re-samples per frame), so a `ColorRange`
 * — which is a static 'value' generator — is not accepted. This is the same white → color,
 * opaque → transparent ramp expressed as a `Gradient`, multiplied into the particle colour.
 */
const fade = (r: number, g: number, b: number): Gradient =>
  new Gradient([[new QuarksVector3(1, 1, 1), 0], [new QuarksVector3(r, g, b), 1]], [[1, 0], [0, 1]]);

/** A single native Quarks trail follows a fixed path; its stored segments fade in place. */
class ShotPath implements Behavior {
  readonly type = 'CardShotPath';
  constructor(private readonly from: Vector3, private readonly to: Vector3,
    private readonly flight: number, private readonly arch: number, private readonly alpha: number) {}
  initialize(particle: Particle): void {
    particle.velocity.set(0, 0, 0);
    if (particle instanceof TrailParticle) particle.previous.push(new RecordState(
      particle.position.clone(), particle.size.x, particle.color.clone()));
  }
  update(particle: Particle, delta: number): void {
    const t = Math.min(1, (particle.age + delta) / Math.max(0.001, this.flight));
    particle.position.set(
      this.from.x + (this.to.x - this.from.x) * t,
      this.from.y + (this.to.y - this.from.y) * t + Math.sin(Math.PI * t) * this.arch,
      this.from.z + (this.to.z - this.from.z) * t,
    );
    particle.velocity.set(0, 0, 0);
    if (particle instanceof TrailParticle) {
      const fade = Math.pow(Math.max(0, 1 - particle.age / particle.life), 1.5);
      particle.color.w = this.alpha * fade;
      for (const record of particle.previous.values()) record.color.w = this.alpha * fade;
    }
  }
  frameUpdate(): void {}
  reset(): void {}
  clone(): Behavior { return new ShotPath(this.from.clone(), this.to.clone(), this.flight, this.arch, this.alpha); }
  toJSON(): object { return { type: this.type, flight: this.flight, arch: this.arch }; }
}

/** MuzzleFlashDemo's atlas/behaviors plus native Trail rendering, fitted to card scale. */
export class QuarksSkillVisuals {
  readonly group = new Group();
  private readonly batch = new BatchedRenderer();
  private readonly atlas: Texture | null;
  private readonly fire: MeshBasicMaterial;
  private readonly smoke: MeshBasicMaterial;
  private readonly gold: MeshBasicMaterial;
  private readonly tracer: MeshBasicMaterial;

  constructor(private readonly density = 1) {
    this.group.name = 'three.quarks:card-artillery';
    this.group.add(this.batch);
    this.atlas = typeof document === 'undefined' ? null : new TextureLoader().load(
      `${import.meta.env.BASE_URL}assets/vfx/quarks/texture1.png`);
    if (this.atlas) this.atlas.colorSpace = SRGBColorSpace;
    this.fire = new MeshBasicMaterial({ map: this.atlas, transparent: true, depthWrite: false,
      blending: AdditiveBlending, side: DoubleSide, toneMapped: false });
    this.smoke = new MeshBasicMaterial({ map: this.atlas, transparent: true, depthWrite: false,
      blending: NormalBlending, side: DoubleSide, toneMapped: false });
    // Solid native ribbon maps keep gold straight and clean, without a flame atlas cell.
    this.gold = new MeshBasicMaterial({ transparent: true, depthWrite: false,
      blending: AdditiveBlending, side: DoubleSide, toneMapped: false });
    this.tracer = this.gold.clone();
  }

  update(delta: number): void {
    this.group.updateWorldMatrix(true, true);
    this.batch.update(delta);
    for (const batch of this.batch.batches) {
      batch.frustumCulled = false; batch.raycast = () => {};
    }
  }

  create(spec: SkillVisualSpec, worldScale: number): SkillVisualHandle {
    const actor = new Group();
    actor.name = `quarks-${spec.template}`;
    this.group.add(actor);
    const systems: ParticleSystem[] = [];
    const scale = Math.max(0.2, worldScale);
    // Global simulation is slowed by ANIMATION_DURATION_SCALE. Scale lifetimes and
    // velocities per cast as well, so fast/skip settings don't change effect layout.
    const ratio = Math.max(0.02, (spec.durationScale ?? ANIMATION_DURATION_SCALE) / ANIMATION_DURATION_SCALE);
    const density = this.density * Math.max(0, Math.min(3, spec.countScale ?? 1));
    const count = (n: number): number => Math.max(1, Math.ceil(n * density));
    const from = spec.from.clone(); const to = spec.to.clone();
    let released = false; let launched = false; let hit = false; let consumed = false;

    const spawn = (name: string, position: Vector3, parameters: Omit<ParticleSystemParameters, 'material'> & { material: Material }): ParticleSystem => {
      const system = new ParticleSystem({
        duration: 0.25 * ratio, looping: false, autoDestroy: false, worldSpace: true,
        emissionOverTime: new ConstantValue(0),
        ...parameters,
      });
      system.emitter.name = name;
      system.emitter.position.copy(position);
      actor.add(system.emitter); systems.push(system); this.batch.addSystem(system);
      return system;
    };
    const burst = (n: number, delay = 0): NonNullable<ParticleSystemParameters['emissionBursts']> => [{
      time: delay * ratio, count: new ConstantValue(count(n)), cycle: 1, interval: 0.01, probability: 1,
    }];
    const explosion = (position: Vector3, volume: number, small = false, delay = 0): void => {
      const radius = volume * scale;
      const flash = spawn('blast-fire-flash', position, {
        material: this.fire, shape: new SphereEmitter({ radius: radius * 0.08, thickness: 1 }),
        startLife: new IntervalValue((small ? 0.08 : 0.28) * ratio, (small ? 0.15 : 0.55) * ratio),
        startSpeed: new IntervalValue(radius * 0.4 / ratio, radius * 1.4 / ratio),
        startSize: new IntervalValue(radius * 0.55, radius * 1.15),
        startRotation: new IntervalValue(-Math.PI, Math.PI),
        startColor: new ColorRange(new Vector4(1, 0.91, 0.53, 0.9), new Vector4(1, 0.35, 0.06, 0.68)),
        emissionBursts: burst(small ? 2 : 14, delay), renderMode: RenderMode.BillBoard,
        startTileIndex: new ConstantValue(81), uTileCount: 10, vTileCount: 10, renderOrder: 12,
      });
      flash.addBehavior(new FrameOverLife(curve(81, 84.33, 87.66, 91)));
      flash.addBehavior(new SizeOverLife(curve(0.4, 1.25, 1.4, 0.1)));
      flash.addBehavior(new ColorOverLife(fade(0.7, 0.28, 0.08)));
      if (small) return;
      const smoke = spawn('blast-smoke-volume', position, {
        material: this.smoke, shape: new SphereEmitter({ radius: radius * 0.15, thickness: 1 }),
        startLife: new IntervalValue(0.85 * ratio, 1.8 * ratio),
        startSpeed: new IntervalValue(radius * 0.25 / ratio, radius * 0.55 / ratio),
        startSize: new IntervalValue(radius * 0.48, radius * 0.85),
        startRotation: new IntervalValue(-Math.PI, Math.PI),
        startColor: new ColorRange(new Vector4(0.4, 0.42, 0.47, 0.48), new Vector4(0.72, 0.7, 0.65, 0.62)),
        emissionBursts: burst(22, delay + 0.035), renderMode: RenderMode.BillBoard,
        startTileIndex: new ConstantValue(28), uTileCount: 10, vTileCount: 10, renderOrder: 9,
      });
      smoke.addBehavior(new FrameOverLife(curve(28, 31, 34, 37)));
      smoke.addBehavior(new SizeOverLife(curve(0.65, 1.2, 1.6, 1.85)));
      smoke.addBehavior(new ColorOverLife(fade(0.85, 0.88, 0.95)));
      smoke.addBehavior(new RotationOverLife(new IntervalValue(-0.35 / ratio, 0.35 / ratio)));
      const sparks = spawn('blast-embers', position, {
        material: this.fire, shape: new SphereEmitter({ radius: radius * 0.1 }),
        startLife: new IntervalValue(0.2 * ratio, 0.65 * ratio),
        startSpeed: new IntervalValue(radius * 1.5 / ratio, radius * 3 / ratio),
        startSize: new IntervalValue(0.018 * scale, 0.055 * scale),
        startColor: new ConstantColor(new Vector4(1, 0.6, 0.14, 0.85)),
        emissionBursts: burst(50, delay), renderMode: RenderMode.BillBoard,
        startTileIndex: new ConstantValue(0), uTileCount: 10, vTileCount: 10, renderOrder: 13,
      });
      sparks.addBehavior(new SizeOverLife(curve(1, 0.8, 0.4, 0)));
      sparks.addBehavior(new ColorOverLife(fade(1, 0.3, 0.02)));
    };
    const collapse = (position: Vector3): void => {
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI * 0.5;
        explosion(position.clone().add(new Vector3(Math.cos(angle) * 0.25 * scale,
          (0.13 + i % 2 * 0.18) * scale, Math.sin(angle) * 0.33 * scale)), 0.56, false, i * 0.025);
      }
    };
    const trail = (gold: boolean, heavy: boolean): void => {
      const flight = heavy ? 0.32 : 0.065;
      const life = heavy ? 0.42 : gold ? 2.15 : 0.20;
      const native = spawn('single-shot-native-trail', from, {
        material: gold ? this.gold : this.tracer, shape: new PointEmitter(),
        startLife: new ConstantValue(life * ratio), startSpeed: new ConstantValue(0),
        startSize: new ConstantValue((heavy ? 0.085 : gold ? 0.027 : 0.024) * scale),
        startColor: new ConstantColor(gold ? new Vector4(1.7, 1.1, 0.18, 0.85) : new Vector4(1.5, 0.65, 0.13, 0.9)),
        emissionBursts: [{ time: 0, count: new ConstantValue(1), cycle: 1, interval: 0.01, probability: 1 }],
        renderMode: RenderMode.Trail, rendererEmitterSettings: { startLength: new ConstantValue(gold ? 300 : 36) },
        renderOrder: 14,
      });
      native.addBehavior(new SizeOverLife(curve(1, 1, 0.7, 0.1)));
      // Gold piercing continues past its numeric impact point; rules and hit timing stay unchanged.
      const end = gold ? to.clone().addScaledVector(to.clone().sub(from).normalize(), PIERCING_END_EXTENSION * scale) : to;
      const distance = from.distanceTo(to);
      const extendedFlight = gold && distance > 0.001 ? flight * from.distanceTo(end) / distance : flight;
      native.addBehavior(new ShotPath(from, end, extendedFlight * ratio, heavy ? 1.1 * scale : 0, gold ? 0.85 : 0.9));
      if (heavy || gold) return;
      // The whole smoke line is born once, instead of continuing to shoot particles.
      // GridEmitter positions stay fixed in world space while their soft sprites expand/fade.
      const direction = to.clone().sub(from);
      const length = direction.length(); direction.normalize();
      const smoke = spawn('straight-lingering-smoke-trail', from.clone().lerp(to, 0.5), {
        material: this.smoke, shape: new GridEmitter({ width: length, height: 0.04 * scale, column: 72, row: 3 }),
        startLife: new IntervalValue(2.4 * ratio, 3.0 * ratio), startSpeed: new ConstantValue(0),
        startSize: new IntervalValue(0.10 * scale, 0.18 * scale), startRotation: new IntervalValue(-Math.PI, Math.PI),
        startColor: new ColorRange(new Vector4(0.82, 0.8, 0.74, 0.54), new Vector4(0.55, 0.58, 0.63, 0.64)),
        emissionBursts: burst(144), renderMode: RenderMode.BillBoard,
        startTileIndex: new ConstantValue(28), uTileCount: 10, vTileCount: 10, renderOrder: 10,
      });
      smoke.emitter.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), direction);
      smoke.addBehavior(new FrameOverLife(curve(28, 31, 34, 37)));
      smoke.addBehavior(new SizeOverLife(curve(0.6, 1.0, 1.5, 2)));
      smoke.addBehavior(new ColorOverLife(fade(1, 1, 1)));
    };

    const handle: SkillVisualHandle = {
      update: (phase) => {
        if (released) return;
        if (!consumed && (spec.template === 'deathBurst' || spec.template === 'deathBombard')) {
          consumed = true;
          if (spec.sourceBurst !== false) collapse(spec.template === 'deathBurst' ? to : from);
        }
        const ranged = spec.template === 'ranged' || spec.template === 'piercing';
        if (!launched && spec.template !== 'deathBurst' && (phase === 'travel' || phase === 'impact' || phase === 'fade')) {
          launched = true; trail(spec.template === 'piercing', !ranged);
        }
        if (!hit && (phase === 'impact' || phase === 'fade')) {
          hit = true;
          if (spec.template === 'ranged') explosion(to, 0.25, true);
          else if (spec.template !== 'piercing' && spec.template !== 'deathBurst') explosion(to, 1.65);
        }
      },
      dispose: () => {
        if (released) return; released = true;
        for (const system of systems) system.dispose();
        actor.removeFromParent();
      },
    };
    handle.update('charge', 0);
    return handle;
  }

  dispose(): void {
    for (const system of [...this.batch.systemToBatchIndex.keys()]) (system as ParticleSystem).dispose();
    for (const batch of this.batch.batches) batch.dispose();
    this.batch.clear();
    this.batch.batches.length = 0;
    this.batch.systemToBatchIndex.clear();
    for (const material of [this.fire, this.smoke, this.gold, this.tracer]) material.dispose();
    this.atlas?.dispose();
  }
}
