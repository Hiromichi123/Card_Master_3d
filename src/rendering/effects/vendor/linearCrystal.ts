/**
 * Adapted from LinearAbiltyCastingThreeJS (MIT).
 * Copyright (c) 2026 mohamedachrefelouafi.
 * Source commit: 97f1de19617e9a2e3af3c8021c8c21c8f58b40f3.
 * Full license: public/assets/vfx/THIRD-PARTY-NOTICES.txt.
 */
import { BufferGeometry, Float32BufferAttribute } from 'three';
const TAU = Math.PI * 2;
function hash11(p: number): number { const x = Math.sin(p * 127.1) * 43758.5453; return x - Math.floor(x); }
const RING_HEIGHTS = [0, 0.22, 0.5, 0.75, 0.92];

function profileRadius(t: number, taper: number) {
  return taper + (1 - taper) * Math.pow(1 - t, 1.15);
}

/**
 * A single ice crystal: a tapered, faceted, slightly bent prism.
 *
 * Unit space — base ring on y = 0 with a circumscribed radius of 0.5, apex at
 * y = 1. An instance therefore scales footprint and height independently, and
 * `local.y` reads straight off as "how far up this crystal am I", which is what
 * the rime banding in `materials/IceMaterial.js` keys off.
 *
 * @param {object} options
 * @param {number} [options.seed]      deterministic shape seed
 * @param {number} [options.sides]     facet count around the prism (5–8 read best)
 * @param {number} [options.taper]     tip radius as a fraction of the base
 * @param {number} [options.roughness] how far facets are pushed off a clean prism
 * @param {number} [options.bend]      sideways curve from base to tip
 */
export function createCrystalGeometry({
  seed = 1,
  sides = 6,
  taper = 0.13,
  roughness = 0.28,
  bend = 0.22
} = {}) {
  const facets = Math.max(3, Math.round(sides));
  const tipRadius = Math.min(0.9, Math.max(0.01, taper));

  // One fixed bend direction per crystal, so a whole field leans convincingly
  // instead of every spike curving the same way.
  const bendAngle = hash11(seed * 1.77) * TAU;
  const bendX = Math.cos(bendAngle);
  const bendZ = Math.sin(bendAngle);

  /** Lateral drift of the crystal's axis at height `t`. */
  const axisOffset = (t: number) => bend * 0.5 * Math.pow(t, 1.6);

  // --- rings -------------------------------------------------------------
  // Angles are jittered once and shared by every ring, so the facets stay
  // continuous edges up the crystal rather than twisting into a screw.
  const angles: number[] = [];
  for (let i = 0; i < facets; i++) {
    const jitter = (hash11(seed * 3.13 + i * 7.7) - 0.5) * (TAU / facets) * 0.55 * roughness * 3;
    angles.push((i / facets) * TAU + jitter);
  }

  const rings = RING_HEIGHTS.map((t, ringIndex) => {
    const baseR = profileRadius(t, tipRadius) * 0.5;
    const drift = axisOffset(t);
    // Height wobble keeps the shoulder lines from stacking into clean bands.
    const y = t + (hash11(seed * 5.9 + ringIndex * 2.3) - 0.5) * 0.06 * roughness * (t > 0 ? 1 : 0);

    return angles.map((angle, i) => {
      // Irregularity grows toward the tip: a crystal is roughly round where it
      // leaves the ground and increasingly ragged where it was torn.
      const wobble = 1 + (hash11(seed * 11.1 + ringIndex * 13.7 + i * 3.9) - 0.5) * roughness * 1.3 * (0.35 + 0.65 * t);
      const r = Math.max(0.002, baseR * wobble);
      return [Math.cos(angle) * r + bendX * drift, y, Math.sin(angle) * r + bendZ * drift];
    });
  });

  // The apex is offset a little off-axis so the tip reads as chipped rather
  // than as the vertex of a cone.
  const apexDrift = axisOffset(1);
  const apex = [
    bendX * apexDrift + (hash11(seed * 17.3) - 0.5) * 0.09 * roughness,
    1,
    bendZ * apexDrift + (hash11(seed * 19.7) - 0.5) * 0.09 * roughness
  ];
  const floorCentre = [0, 0, 0];

  // --- triangles ---------------------------------------------------------
  const positions: number[] = [];
  const push = (p: readonly number[]) => positions.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);

  for (let ring = 0; ring < rings.length - 1; ring++) {
    const lower = rings[ring]!;
    const upper = rings[ring + 1]!;
    for (let i = 0; i < facets; i++) {
      const j = (i + 1) % facets;
      push(lower[i]!); push(lower[j]!); push(upper[i]!);
      push(lower[j]!); push(upper[j]!); push(upper[i]!);
    }
  }

  const top = rings[rings.length - 1]!;
  const base = rings[0]!;
  for (let i = 0; i < facets; i++) {
    const j = (i + 1) % facets;
    push(top[i]!); push(top[j]!); push(apex); // the point
    push(floorCentre); push(base[j]!); push(base[i]!); // the underside
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  // Non-indexed + per-face normals: this is what makes the facets crisp.
  geometry.computeVertexNormals();
  return geometry;
}

