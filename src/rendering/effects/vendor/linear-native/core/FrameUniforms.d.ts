import type { Texture, Vector2, Vector3 } from 'three';
export const frame: {
 uTime: { value: number }; uDelta: { value: number }; uResolution: { value: Vector2 };
 uSceneDepth: { value: Texture | null }; uEnvMap: { value: Texture | null };
 uCameraNear: { value: number }; uCameraFar: { value: number }; uLightDir: { value: Vector3 };
 uShaderIntensity: { value: number }; uGlobalGlow: { value: number };
};
