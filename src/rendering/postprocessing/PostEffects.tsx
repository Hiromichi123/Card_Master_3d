import { Bloom, EffectComposer } from '@react-three/postprocessing';

import {
  BLOOM_LUMINANCE_SMOOTHING,
  MIN_BLOOM_THRESHOLD,
  type QualityProfile,
} from '../quality';
import type { TableTheme } from '../table/themes';

/**
 * 后处理链（`V-PP-1..2`）。
 *
 * 工程内**只有这一处**引入 EffectComposer，避免多套后处理互相覆盖。
 *
 * 泛光由两者共同决定：
 * - **台面主题**给基准强度与阈值（移植自棋盘项目的配色性格：
 *   霓虹要鬼火一样的辉光，木桌几乎不闪）；
 * - **画质档**决定是否启用，以及在同一性格上打多少折。
 *
 * 阈值下钳制在 `MIN_BLOOM_THRESHOLD`——主题给的值是按深色场景调的，
 * 直接用到本项目会把大块卡面一起点亮。理由写在那条常量旁边。
 *
 * 低画质档直接不挂载 EffectComposer：核显上后处理的填充率开销最大，
 * 关掉它比调低参数更彻底。
 */
export interface PostEffectsProps {
  readonly profile: QualityProfile;
  readonly theme: TableTheme;
}

export function PostEffects({ profile, theme }: PostEffectsProps) {
  if (!profile.bloom) {
    return null;
  }

  const intensity = theme.post.bloom * profile.bloomScale;
  const threshold = Math.max(theme.post.bloomThreshold, MIN_BLOOM_THRESHOLD);

  if (intensity <= 0.001) {
    return null;
  }

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={intensity}
        luminanceThreshold={threshold}
        luminanceSmoothing={BLOOM_LUMINANCE_SMOOTHING}
        mipmapBlur
        radius={0.7}
      />
    </EffectComposer>
  );
}
