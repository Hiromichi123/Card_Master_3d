import { QUALITY_LABELS, type QualityTier } from '../rendering/quality';
import { useSettingsStore, type PresentationSpeed } from '../state/settingsStore';

/**
 * 全局画质与演出控制。
 *
 * 放在导航栏而不是各场景内部：这些开关是**全局**的，
 * 每个场景各放一份会出现「在这里调了、切场景又变回去」的困惑。
 *
 * `V-FX-5` / `V-WORLD-5` 都要求这些设置不得改变战斗结果——
 * 它们只影响 dpr、粒子容量、Bloom、阴影与播放时长。
 */

const QUALITY_ORDER: QualityTier[] = ['low', 'medium', 'high'];

const SPEED_LABELS: { value: PresentationSpeed; label: string }[] = [
  { value: 'normal', label: '正常' },
  { value: 'fast', label: '快速' },
  { value: 'skip', label: '跳过' },
];

export function QualityControl() {
  const quality = useSettingsStore((state) => state.quality);
  const setQuality = useSettingsStore((state) => state.setQuality);
  const speed = useSettingsStore((state) => state.presentationSpeed);
  const setSpeed = useSettingsStore((state) => state.setPresentationSpeed);
  const cameraShake = useSettingsStore((state) => state.cameraShake);
  const setCameraShake = useSettingsStore((state) => state.setCameraShake);
  const showPerf = useSettingsStore((state) => state.showPerf);
  const setShowPerf = useSettingsStore((state) => state.setShowPerf);

  return (
    <div className="quality">
      <label className="quality__group" title="画质档：只影响表现，不影响战斗结果">
        <span className="quality__label">画质</span>
        <span className="quality__segmented">
          {QUALITY_ORDER.map((tier) => (
            <button
              key={tier}
              type="button"
              className={tier === quality ? 'quality__seg quality__seg--on' : 'quality__seg'}
              onClick={() => setQuality(tier)}
            >
              {QUALITY_LABELS[tier]}
            </button>
          ))}
        </span>
      </label>

      <label className="quality__group" title="演出速度：只压缩播放时长">
        <span className="quality__label">演出</span>
        <span className="quality__segmented">
          {SPEED_LABELS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={
                item.value === speed ? 'quality__seg quality__seg--on' : 'quality__seg'
              }
              onClick={() => setSpeed(item.value)}
            >
              {item.label}
            </button>
          ))}
        </span>
      </label>

      <label className="quality__group quality__group--check" title="镜头震动（不影响战斗结果）">
        <input
          type="checkbox"
          checked={cameraShake}
          onChange={(event) => setCameraShake(event.target.checked)}
        />
        震动
      </label>

      <label className="quality__group quality__group--check" title="性能读数条">
        <input
          type="checkbox"
          checked={showPerf}
          onChange={(event) => setShowPerf(event.target.checked)}
        />
        性能
      </label>
    </div>
  );
}
