import { CLOUD_SURFACE_Y, CLOUD_BODY_TOP } from '../../src/rendering/battle/cloudSurfaceLayout';
import { MeshStandardMaterial, ShaderLib } from 'three';
import { expect, it } from 'vitest';
import { TABLE_THEMES } from '../../src/rendering/table/themes';
import { cloudBuildingLayout } from '../../src/rendering/battle/cloudPalaceLayout';
import { cloudGuideGeometry } from '../../src/rendering/battle/cloudGuideGeometry';
import { buildCloudGate } from '../../src/rendering/battle/cloudPalaceGeometry';
import { applyCloudShadows } from '../../src/rendering/battle/cloudShadowMaterial';
it('uses the requested featured table order and retains remaining table order', () => {
  const ids = TABLE_THEMES.map(t => t.id);
  expect(ids).toEqual(['tournament', 'abyss', 'cloud-top', 'white-mecha', 'obsidian', 'volcano', 'marble', 'wasteland', 'snow']);
});
it('puts one or two buildings on every cloud island and two outside the main combat lanes', () => {
  const islands = Array.from({ length: 30 }, (_, cluster) => ({ cluster, x: cluster * 12, y: 2, z: -30, sy: 1.4 }));
  const plan = cloudBuildingLayout(islands), all = [...plan.halls, ...plan.towers, ...plan.gates];
  for (const cloud of islands) {
    const buildings = all.filter(b => b.cluster === cloud.cluster);
    expect(buildings.length).toBeGreaterThanOrEqual(1); expect(buildings.length).toBeLessThanOrEqual(2);
    expect(buildings.every(b => b.y > cloud.y)).toBe(true);
  }
  const home = all.filter(b => b.cluster === undefined);
  expect(home).toHaveLength(2); expect(home.every(b => Math.abs(b.x) > 6.3)).toBe(true);
  expect(plan.gates.some(g => g.cluster === undefined && g.x > 6)).toBe(true);
  expect(plan.gates.some(g => g.cluster !== undefined)).toBe(true);
});
it('renders the gold inlay upward and keeps the gate open at its center', () => {
  const guide = cloudGuideGeometry(), normal = guide.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(.99);
  expect(guide.boundingBox!.min.x).toBeGreaterThan(-8.1); expect(guide.boundingBox!.max.x).toBeLessThan(8.1); guide.dispose();
  const gate = buildCloudGate();
  for (const geometry of Object.values(gate)) {
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-.001);
    geometry.dispose();
  }
  const material = new MeshStandardMaterial(), time = applyCloudShadows(material);
  const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as never);
  expect(shader.vertexShader).toContain('vCloudGround = position.xz');
  expect(shader.fragmentShader).toContain('outgoingLight = cloudProjection()');
  expect(shader.fragmentShader).toContain('mix(vec3(1.0),vec3(.60,.66,.74),shadow)');
  expect(shader.fragmentShader).toContain('uCloudShadowTime*.054');
  time.value = 8;
  expect((shader.uniforms as Record<string, { value: number }>).uCloudShadowTime!.value).toBe(8);
  material.dispose();
});

it('keeps the flattened cloud body safely below the playable surface at all camera angles', () => {
  expect(CLOUD_SURFACE_Y - CLOUD_BODY_TOP).toBeGreaterThan(.25);
  expect(CLOUD_SURFACE_Y).toBeLessThan(0); // Existing card and gold-line height remains unchanged.
});
