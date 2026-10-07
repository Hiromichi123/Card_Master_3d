import { useState } from 'react';

import { CAMERA_MODES } from '../rendering/battle/cameraModes';
import { QUALITY_LABELS, type QualityTier } from '../rendering/quality';
import { TABLE_THEMES } from '../rendering/table/themes';
import { useSettingsStore, type PresentationSpeed } from '../state/settingsStore';

/**
 * 战斗设置：台面、视角、画质、演出、震动、静止。
 *
 * **放在战斗界面里，不放全局抬头**（2026-10-07 用户要求）。抬头是「去哪一屏」的导航，
 * 而这一组开关全都只对 3D 战桌的观感有意义；把它们和导航挤在一行，
 * 既不常改、又在每一屏占着位置。抬头里只留下「性能读数」这一个开发用开关。
 *
 * 两处调用、两种默认状态，理由都是「那一刻你想干什么」：
 * - **对局菜单**里默认展开（`defaultOpen`）——开局前正是配置台面与视角的时候；
 * - **战斗中**默认收起成一行「战斗设置」——战桌是主角，不该被一排控件挡住。
 *
 * 无论放在哪，读写的都是同一个 store：切场景不会「调了又变回去」。
 * `V-FX-5` / `V-WORLD-5`：这里的每一项都只影响表现，不得改变战斗结果。
 */

const QUALITY_ORDER: QualityTier[] = ['low', 'medium', 'high'];

const SPEED_LABELS: { value: PresentationSpeed; label: string }[] = [
  { value: 'normal', label: '正常' },
  { value: 'fast', label: '快速' },
  { value: 'skip', label: '跳过' },
];

export interface BattleSettingsProps {
  /** 初始是否展开。缺省收起。 */
  readonly defaultOpen?: boolean;
  /**
   * 排布列数。
   *
   * 菜单里给 2（那一屏是「填一张表」的形态，两列正好一行放得下），
   * 战斗 HUD 里给 1（右下角是一条竖列，横向铺开会压到日志）。
   */
  readonly columns?: 1 | 2;
}

export function BattleSettings({ defaultOpen = false, columns = 1 }: BattleSettingsProps) {
  const [open, setOpen] = useState(defaultOpen);

  const quality = useSettingsStore((state) => state.quality);
  const setQuality = useSettingsStore((state) => state.setQuality);
  const speed = useSettingsStore((state) => state.presentationSpeed);
  const setSpeed = useSettingsStore((state) => state.setPresentationSpeed);
  const cameraShake = useSettingsStore((state) => state.cameraShake);
  const setCameraShake = useSettingsStore((state) => state.setCameraShake);
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);
  const setReduceMotion = useSettingsStore((state) => state.setReduceMotion);
  const tableThemeId = useSettingsStore((state) => state.tableThemeId);
  const setTableTheme = useSettingsStore((state) => state.setTableTheme);
  const cameraModeId = useSettingsStore((state) => state.cameraModeId);
  const setCameraMode = useSettingsStore((state) => state.setCameraMode);

  return (
    <section className={open ? 'battle-settings battle-settings--open' : 'battle-settings'}>
      <button
        type="button"
        className="battle-settings__head"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        战斗设置
        <span className="battle-settings__chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className={`battle-settings__body battle-settings__body--cols-${columns}`}>
          <label className="battle-settings__group" title="战斗台面：材质、配色、背景与雾一起换">
            <span className="battle-settings__label">台面</span>
            <select
              className="battle-settings__select"
              aria-label="战斗台面"
              value={tableThemeId}
              onChange={(event) => setTableTheme(event.target.value)}
            >
              {TABLE_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>

          <label className="battle-settings__group" title="相机视角；在场景里拖动可自由旋转">
            <span className="battle-settings__label">视角</span>
            <select
              className="battle-settings__select"
              aria-label="相机视角"
              value={cameraModeId}
              onChange={(event) => setCameraMode(event.target.value as typeof cameraModeId)}
            >
              {CAMERA_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.name}
                </option>
              ))}
            </select>
          </label>

          <label className="battle-settings__group" title="画质档：只影响表现，不影响战斗结果">
            <span className="battle-settings__label">画质</span>
            <span className="battle-settings__segmented">
              {QUALITY_ORDER.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  className={
                    tier === quality ? 'battle-settings__seg battle-settings__seg--on' : 'battle-settings__seg'
                  }
                  onClick={() => setQuality(tier)}
                >
                  {QUALITY_LABELS[tier]}
                </button>
              ))}
            </span>
          </label>

          <label className="battle-settings__group" title="演出速度：只压缩播放时长">
            <span className="battle-settings__label">演出</span>
            <span className="battle-settings__segmented">
              {SPEED_LABELS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={
                    item.value === speed ? 'battle-settings__seg battle-settings__seg--on' : 'battle-settings__seg'
                  }
                  onClick={() => setSpeed(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </span>
          </label>

          <label className="battle-settings__group battle-settings__group--check" title="镜头震动（不影响战斗结果）">
            <input
              type="checkbox"
              checked={cameraShake}
              onChange={(event) => setCameraShake(event.target.checked)}
            />
            震动
          </label>

          <label className="battle-settings__group battle-settings__group--check" title="冻结天气层（不移除）">
            <input
              type="checkbox"
              checked={reduceMotion}
              onChange={(event) => setReduceMotion(event.target.checked)}
            />
            静止
          </label>
        </div>
      )}
    </section>
  );
}

/**
 * 性能读数开关。
 *
 * **这个留在抬头**：它是开发用的读数条（帧耗时、draw calls），
 * 与「去哪一屏」无关，而且每一屏都可能要看——放回抬头比塞进战斗设置更合适。
 */
export function PerfToggle() {
  const showPerf = useSettingsStore((state) => state.showPerf);
  const setShowPerf = useSettingsStore((state) => state.setShowPerf);

  return (
    <label className="app-nav__perf" title="性能读数条">
      <input
        type="checkbox"
        checked={showPerf}
        onChange={(event) => setShowPerf(event.target.checked)}
      />
      性能
    </label>
  );
}
