import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Group,
  Mesh, PlaneGeometry, Points, ShaderMaterial, type WebGLRenderer,
} from 'three';
import type { SkillVisualHandle, SkillVisualSpec } from './SkillVisualPool';
import {
  SLASH_CROSS_DELAY, SLASH_LIFETIME, SLASH_RADIUS, SLASH_SWEEP_SECONDS, SLASH_WIDTH,
  SWORD_DANCE_ARCS, SWORD_DANCE_STEP_SECONDS, slashTiming,
} from './slashTiming';

// Adapted from the user's new.js: elliptical reverse sweep, tapered tail,
// white core, and sparks born along the moving edge. No DOM or second RAF.
const BLADE_VERTEX = `
  varying vec2 vPosition;
  void main() {
    vPosition = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BLADE_FRAGMENT = `
  varying vec2 vPosition;
  uniform float uTime, uRadius, uWidth, uDuration, uSweep;
  uniform vec3 uColor;
  void main() {
    vec2 p = vec2(vPosition.x, vPosition.y / 1.50);
    float angle = atan(p.y, p.x);
    float progress = clamp(uTime / uSweep, 0.0, 1.0);
    float head = 1.2 - 2.4 * (1.0 - pow(1.0 - progress, 2.0));
    float behind = angle - head;
    if (angle < -1.2 || behind < 0.0 || behind > 2.5) discard;
    float tail = 1.0 - smoothstep(0.0, 2.5, behind);
    float width = uWidth * (0.15 + 0.85 * tail);
    float distanceToEdge = abs(length(p) - uRadius);
    float core = exp(-pow(distanceToEdge / (width * 0.22), 2.0));
    float glow = exp(-pow(distanceToEdge / width, 2.0));
    float fade = 1.0 - smoothstep(uSweep, uDuration, uTime);
    float appear = smoothstep(0.0, 0.025, uTime);
    float alpha = (core + glow * 0.5) * tail * fade * appear;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.9), alpha);
  }
`;
const SPARK_VERTEX = `
  attribute float aAlpha;
  varying float vAlpha;
  uniform float uSize;
  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
  }
`;
const SPARK_FRAGMENT = `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.0, 1.0, d)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.65), a);
  }
`;

interface Spark {
  born: number; life: number; x: number; y: number; vx: number; vy: number; vz: number;
}
interface Arc {
  group: Group;
  delay: number;
  blade: ShaderMaterial;
  sparks: ShaderMaterial;
  geometry: BufferGeometry;
  positions: Float32Array;
  alphas: Float32Array;
  particles: Spark[];
}

/** Target-local actors; time comes only from the game's shared Timeline. */
export class SlashSkillVisuals {
  readonly group = new Group();
  private readonly plane = new PlaneGeometry(5, 5);
  private readonly sparkMaterials = new Set<ShaderMaterial>();

  updateFrame(renderer: WebGLRenderer): void {
    for (const material of this.sparkMaterials) material.uniforms['uSize']!.value = 5 * renderer.getPixelRatio();
  }

  create(spec: SkillVisualSpec, worldScale: number): SkillVisualHandle {
    const dance = spec.template === 'swordDance' || spec.template === 'groupSwordDance';
    const timing = slashTiming(spec.template);
    const color = spec.tint?.clone() ?? new Color('#55bbff');
    const actor = new Group();
    actor.name = `authored-${spec.template}`;
    actor.position.copy(spec.to);
    actor.position.y += 0.075 * worldScale;
    actor.rotation.x = -Math.PI / 2;
    actor.scale.setScalar(0.48 * Math.max(0.2, worldScale));
    const arcs: Arc[] = [];
    const directions = dance ? [-Math.PI / 4, Math.PI / 4, 0.08, Math.PI / 2 - 0.12, -Math.PI / 2 + 0.2, Math.PI + 0.3]
      : [-Math.PI / 4, Math.PI / 4];
    const count = Math.ceil((dance ? 32 : 64) * Math.max(0, Math.min(2, spec.countScale ?? 1)));

    for (let index = 0; index < (dance ? SWORD_DANCE_ARCS : 2); index++) {
      const arcGroup = new Group();
      arcGroup.rotation.set(dance ? (index % 3 - 1) * 0.1 : 0, dance ? (index % 2 ? 0.08 : -0.08) : 0, directions[index]!);
      arcGroup.scale.x = index % 2 === 0 ? 1 : -1;
      if (dance) arcGroup.position.set((index % 3 - 1) * 0.15, (index % 2 - 0.5) * 0.12, index * 0.035);
      const bladeMaterial = new ShaderMaterial({
        vertexShader: BLADE_VERTEX, fragmentShader: BLADE_FRAGMENT,
        transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false,
        uniforms: { uTime: { value: 0 }, uColor: { value: color }, uRadius: { value: SLASH_RADIUS },
          uWidth: { value: SLASH_WIDTH }, uDuration: { value: SLASH_LIFETIME }, uSweep: { value: SLASH_SWEEP_SECONDS } },
      });
      const blade = new Mesh(this.plane, bladeMaterial);
      blade.position.x = -SLASH_RADIUS;
      arcGroup.add(blade);

      const positions = new Float32Array(count * 3);
      const alphas = new Float32Array(count);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('aAlpha', new BufferAttribute(alphas, 1));
      const sparkMaterial = new ShaderMaterial({
        vertexShader: SPARK_VERTEX, fragmentShader: SPARK_FRAGMENT,
        transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
        uniforms: { uColor: { value: color }, uSize: { value: 5 } },
      });
      this.sparkMaterials.add(sparkMaterial);
      arcGroup.add(new Points(geometry, sparkMaterial));
      const particles = Array.from({ length: count }, (): Spark => {
        const born = Math.random() * SLASH_SWEEP_SECONDS;
        const progress = born / SLASH_SWEEP_SECONDS;
        const angle = 1.2 - 2.4 * (1 - (1 - progress) ** 2);
        const speed = 1.2 + Math.random() * 3;
        return { born, life: 0.2 + Math.random() * 0.35,
          x: Math.cos(angle) * SLASH_RADIUS - SLASH_RADIUS, y: Math.sin(angle) * SLASH_RADIUS * 1.50,
          vx: Math.cos(angle) * speed + Math.sin(angle) * 1.2,
          vy: Math.sin(angle) * speed * 1.1 - Math.cos(angle) * 1.2, vz: Math.random() * 1.2 };
      });
      arcs.push({ group: arcGroup, delay: index * (dance ? SWORD_DANCE_STEP_SECONDS : SLASH_CROSS_DELAY),
        blade: bladeMaterial, sparks: sparkMaterial, geometry, positions, alphas, particles });
      actor.add(arcGroup);
    }
    actor.traverse((object) => { object.frustumCulled = false; object.raycast = () => {}; });
    actor.visible = false;
    this.group.add(actor);
    let released = false;
    return {
      update: (phase, progress) => {
        if (released) return;
        actor.visible = phase === 'impact' || phase === 'fade';
        if (!actor.visible) return;
        const age = phase === 'impact' ? timing.sweep * progress : timing.sweep + timing.fade * progress;
        for (const arc of arcs) {
          const local = age - arc.delay;
          arc.group.visible = local >= 0 && local < SLASH_LIFETIME;
          if (!arc.group.visible) continue;
          arc.blade.uniforms['uTime']!.value = local;
          for (let i = 0; i < arc.particles.length; i++) {
            const particle = arc.particles[i]!;
            const elapsed = Math.max(0, local - particle.born);
            arc.positions[i * 3] = particle.x + particle.vx * elapsed;
            arc.positions[i * 3 + 1] = particle.y + particle.vy * elapsed - 1.8 * elapsed * elapsed;
            arc.positions[i * 3 + 2] = particle.vz * elapsed;
            arc.alphas[i] = local < particle.born ? 0 : Math.max(0, 1 - elapsed / particle.life) ** 2;
          }
          arc.geometry.getAttribute('position').needsUpdate = true;
          arc.geometry.getAttribute('aAlpha').needsUpdate = true;
        }
      },
      dispose: () => {
        if (released) return;
        released = true;
        actor.removeFromParent();
        for (const arc of arcs) {
          this.sparkMaterials.delete(arc.sparks);
          arc.blade.dispose(); arc.sparks.dispose(); arc.geometry.dispose();
        }
      },
    };
  }

  dispose(): void { this.plane.dispose(); this.sparkMaterials.clear(); }
}
