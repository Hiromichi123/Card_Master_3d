import type { MeshStandardMaterial } from 'three';

/** Continuous cloud projection is part of the opaque board, never an overlapping mesh. */
export function applyCloudShadows(material: MeshStandardMaterial) {
  const time = { value: 0 };
  material.onBeforeCompile = shader => {
    shader.uniforms.uCloudShadowTime = time;
    shader.vertexShader = `varying vec2 vCloudGround;\n${shader.vertexShader}`.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloudGround = position.xz;');
    shader.fragmentShader = `uniform float uCloudShadowTime; varying vec2 vCloudGround;
      vec3 cloudProjection(){
        vec2 p=vCloudGround*vec2(.18,.23)+vec2(uCloudShadowTime*.054,-uCloudShadowTime*.036);
        // Analytic low-frequency field has no grid cells, wrap boundaries or hash precision seams.
        float n=.5+.20*sin(p.x*2.1+.8*sin(p.y*1.6))+.16*sin(p.y*2.2+.7*sin(p.x*1.7))+.08*sin(p.x*1.6-p.y*1.8);
        // Only a narrow penumbra changes tone; the remaining sunlit surface is pure white.
        float shadow=smoothstep(.56,.64,n);
        return mix(vec3(1.0),vec3(.60,.66,.74),shadow);
      }\n${shader.fragmentShader}`.replace('#include <opaque_fragment>', 'outgoingLight = cloudProjection();\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'cloud-board-shadow-v5';
  return time;
}
