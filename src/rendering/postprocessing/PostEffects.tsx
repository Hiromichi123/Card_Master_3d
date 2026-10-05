import { Bloom, EffectComposer } from '@react-three/postprocessing';

import {
  BLOOM_LUMINANCE_SMOOTHING,
  BLOOM_LUMINANCE_THRESHOLD,
  type QualityProfile,
} from '../quality';

/**
 * 后处理链（`V-PP-1..2`）。
 *
 * 工程内**只有这一处**引入 EffectComposer，避免多套后处理互相覆盖。
 *
 * 关键取舍：Bloom 的亮度阈值定在 0.9。
 * 阈值低会让整个画面发光，卡面插画与中文第一个被糊掉——`V-PP-2` 明确禁止。
 * 高阈值意味着只有接近纯白的像素参与泛光，也就是粒子高光与闪电核心这类
 * 本来就该过曝的地方。
 *
 * 低画质档直接不挂载 EffectComposer：核显上后处理的填充率开销最大，
 * 而关掉它比调低参数更彻底。
 */
export interface PostEffectsProps {
  readonly profile: QualityProfile;
}

export function PostEffects({ profile }: PostEffectsProps) {
  if (!profile.bloom) {
    return null;
  }

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={profile.bloomIntensity}
        luminanceThreshold={BLOOM_LUMINANCE_THRESHOLD}
        luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
        mipmapBlur
        radius={0.7}
      />
    </EffectComposer>
  );
}
