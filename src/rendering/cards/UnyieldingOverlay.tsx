import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, DoubleSide, NormalBlending, ShaderMaterial, Vector2 } from 'three';
import { CARD_DIMENSIONS, CARD_FACE_OFFSET } from './cardGeometry';

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRAGMENT = `
  varying vec2 vUv;
  uniform vec2 uSize;
  uniform float uTime;
  float roundedBox(vec2 p, vec2 halfSize, float radius) {
    vec2 q = abs(p) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }
  void main() {
    vec2 p = (vUv - 0.5) * uSize * vec2(1.30, 1.20);
    float d = roundedBox(p, uSize * 0.5, 0.07);
    #ifdef DARK_CENTER
      float inside = 1.0 - smoothstep(-0.015, 0.015, d);
      float center = 1.0 - smoothstep(0.0, 0.65, length(p / uSize));
      float alpha = inside * (0.16 + center * 0.20);
      if (alpha < 0.005) discard;
      gl_FragColor = vec4(0.04, 0.001, 0.006, alpha);
    #else
      float pulse = 0.85 + 0.15 * sin(uTime * 3.8);
      float edge = exp(-pow(d / 0.035, 2.0));
      float flicker = 0.75 + 0.25 * sin(p.x * 38.0 + p.y * 24.0 - uTime * 4.2);
      float spill = exp(-abs(d) * 19.0) * flicker;
      float alpha = (edge * 0.90 + spill * 0.35) * pulse;
      if (alpha < 0.005) discard;
      gl_FragColor = vec4(vec3(1.55, 0.012, 0.055), alpha);
    #endif
  }
`;

/** Card-local persistent status, following its motion, flying lift and face orientation. */
export function UnyieldingOverlay() {
  const materials = useMemo(() => {
    const make = (dark: boolean): ShaderMaterial => new ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, defines: dark ? { DARK_CENTER: '' } : {},
      transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false,
      blending: dark ? NormalBlending : AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uSize: { value: new Vector2(CARD_DIMENSIONS.width, CARD_DIMENSIONS.height) } },
    });
    return [make(true), make(false)] as const;
  }, []);
  useFrame((_, delta) => {
    for (const material of materials) material.uniforms['uTime']!.value += Math.min(delta, 0.05);
  });
  useEffect(() => () => { for (const material of materials) material.dispose(); }, [materials]);
  return (
    <group>
      {materials.map((material, index) => (
        <mesh key={index} position={[0, 0, CARD_FACE_OFFSET + 0.006 + index * 0.002]}
          material={material} raycast={() => {}} renderOrder={8 + index}>
          <planeGeometry args={[CARD_DIMENSIONS.width * 1.30, CARD_DIMENSIONS.height * 1.20]} />
        </mesh>
      ))}
    </group>
  );
}
