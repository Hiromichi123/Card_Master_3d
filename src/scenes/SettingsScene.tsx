import { useRef, useState } from 'react';

import { CAMERA_MODES } from '../rendering/battle/cameraModes';
import { QUALITY_LABELS, type QualityTier } from '../rendering/quality';
import { TABLE_THEMES } from '../rendering/table/themes';
import { audioEngine } from '../services/audio/AudioEngine';
import { downloadJson, saveFileName } from '../services/save/downloadJson';
import { pushToast } from '../state/toastStore';
import { hydrateSettings } from '../state/settingsPersistence';
import { isPresetValues, useSettingsStore, type PresentationSpeed } from '../state/settingsStore';
import type { ProfileStore } from '../state/createProfileStore';
import type { ProfileState } from '../domain/progression/types';
import type { ImportFile, ImportPreview } from '../domain/progression/saveTransfer';
import { Modal } from '../ui/Modal';
import { ScrollArea } from '../ui/ScrollArea';
import type { RouteId } from '../app/routes';

/**
 * 设置。
 *
 * 这里是**表现设置的全局家**：画面档、台面、视角、演出、音量、存档。
 * 战斗界面里的「战斗设置」（`ui/BattleSettings.tsx`）**保持不动**——它按设计
 * 只管 3D 战桌的即时观感；两处改的是同一个 store，切屏不会丢。
 *
 * 三件事值得记住：
 * 1. **所有设置都写进存档**（`ProfileStore.updateSettings`，防抖合并落盘），
 *    由 `state/settingsPersistence` 双向接线——刷新不会丢。
 * 2. **画质档是「预设 + 四个可覆盖参数」**。点低/中/高是把四个参数一次写回；
 *    单独调任意一项就变成「自定义」。
 * 3. **音效是程序合成的**（`services/audio`），不依赖任何音频资源文件。
 */

const QUALITY_ORDER: QualityTier[] = ['low', 'medium', 'high'];

const SPEED_LABELS: { value: PresentationSpeed; label: string }[] = [
  { value: 'normal', label: '正常' },
  { value: 'fast', label: '快速' },
  { value: 'skip', label: '跳过' },
];

export interface SettingsSceneProps {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly onNavigate: (route: RouteId) => void;
}

export function SettingsScene({ profile, store, onNavigate }: SettingsSceneProps) {
  const quality = useSettingsStore((state) => state.quality);
  const setQuality = useSettingsStore((state) => state.setQuality);
  const dprCap = useSettingsStore((state) => state.dprCap);
  const setDprCap = useSettingsStore((state) => state.setDprCap);
  const particleBudget = useSettingsStore((state) => state.particleBudget);
  const setParticleBudget = useSettingsStore((state) => state.setParticleBudget);
  const bloom = useSettingsStore((state) => state.bloom);
  const setBloom = useSettingsStore((state) => state.setBloom);
  const shadows = useSettingsStore((state) => state.shadows);
  const setShadows = useSettingsStore((state) => state.setShadows);
  const effective = useSettingsStore((state) => state.profile);
  const presentationSpeed = useSettingsStore((state) => state.presentationSpeed);
  const setPresentationSpeed = useSettingsStore((state) => state.setPresentationSpeed);
  const cameraShake = useSettingsStore((state) => state.cameraShake);
  const setCameraShake = useSettingsStore((state) => state.setCameraShake);
  const reduceMotion = useSettingsStore((state) => state.reduceMotion);
  const setReduceMotion = useSettingsStore((state) => state.setReduceMotion);
  const tableThemeId = useSettingsStore((state) => state.tableThemeId);
  const setTableTheme = useSettingsStore((state) => state.setTableTheme);
  const cameraModeId = useSettingsStore((state) => state.cameraModeId);
  const setCameraMode = useSettingsStore((state) => state.setCameraMode);
  const masterVolume = useSettingsStore((state) => state.masterVolume);
  const setMasterVolume = useSettingsStore((state) => state.setMasterVolume);
  const showPerf = useSettingsStore((state) => state.showPerf);
  const setShowPerf = useSettingsStore((state) => state.setShowPerf);

  const [advanced, setAdvanced] = useState(false);
  const custom = !isPresetValues(quality, { dprCap, particleBudget, bloom, shadows });

  // 离开这一屏时把待写的设置推平（与组卡页同一手）
  const leaving = () => {
    void store.flush();
    onNavigate('hub');
  };

  const onPreviewSound = () => {
    void audioEngine.resume().then(() => audioEngine.play('gacha', { bright: true }));
  };

  /**
   * 松手时响一声，让「拖音量」本身有反馈。
   *
   * 只要**松手**那一下，不要拖动过程中每帧都响；用短促的 `deal` 而不是
   * 试听那个琶音——它更像一次「咔哒」，不喧宾夺主。
   */
  const onVolumeRelease = () => {
    void audioEngine.resume().then(() => audioEngine.play('deal'));
  };

  const cardCount = Object.values(profile.inventory).reduce((sum, n) => sum + n, 0);

  return (
    <div className="screen settings">
      <header className="screen__head">
        <div>
          <h1 className="screen__title">设置</h1>
          <p className="settings__lead">这里的每一项都只影响表现，不会改变战斗结果。</p>
        </div>
        <button type="button" className="settings__back" onClick={leaving}>
          返回主菜单
        </button>
      </header>

      <ScrollArea>
        <div className="settings__grid">
          {/* --- 画面 --- */}
          <section className="settings__panel" aria-label="画面">
            <h2 className="settings__title">画面</h2>

            <div className="settings__row">
              <span className="settings__label">画质档</span>
              <span className="settings__segmented">
                {QUALITY_ORDER.map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    className={
                      !custom && tier === quality
                        ? 'settings__seg settings__seg--on'
                        : 'settings__seg'
                    }
                    onClick={() => setQuality(tier)}
                  >
                    {QUALITY_LABELS[tier]}
                  </button>
                ))}
              </span>
              <span className="settings__note">
                {custom ? '自定义（与三个预设都不同）' : '当前等于预设值'}
              </span>
            </div>

            <button
              type="button"
              className="settings__disclosure"
              onClick={() => setAdvanced((value) => !value)}
              aria-expanded={advanced}
            >
              高级（逐项覆盖）
              <span aria-hidden>{advanced ? '▾' : '▸'}</span>
            </button>

            {advanced && (
              <div className="settings__advanced">
                <label className="settings__row" title="设备像素比上限，核显上填充率的主要瓶颈">
                  <span className="settings__label">DPR 上限</span>
                  <input
                    type="range"
                    min={1}
                    max={2}
                    step={0.25}
                    value={dprCap}
                    aria-label="DPR 上限"
                    onChange={(event) => setDprCap(Number(event.target.value))}
                  />
                  <span className="settings__value">{dprCap.toFixed(2)}</span>
                </label>

                <div className="settings__row" title="粒子池容量">
                  <span className="settings__label">粒子预算</span>
                  <span className="settings__segmented">
                    {QUALITY_ORDER.map((tier) => (
                      <button
                        key={tier}
                        type="button"
                        className={
                          tier === particleBudget
                            ? 'settings__seg settings__seg--on'
                            : 'settings__seg'
                        }
                        onClick={() => setParticleBudget(tier)}
                      >
                        {QUALITY_LABELS[tier]}
                      </button>
                    ))}
                  </span>
                </div>

                <label className="settings__row settings__row--check">
                  <input type="checkbox" checked={bloom} onChange={(e) => setBloom(e.target.checked)} />
                  Bloom 泛光
                </label>
                <label className="settings__row settings__row--check">
                  <input
                    type="checkbox"
                    checked={shadows}
                    onChange={(e) => setShadows(e.target.checked)}
                  />
                  阴影
                </label>
              </div>
            )}

            {/* 只读回显：让「改了哪一项」看得见 */}
            <dl className="settings__readout">
              <div>
                <dt>有效 DPR</dt>
                <dd>{effective.dprCap.toFixed(2)}</dd>
              </div>
              <div>
                <dt>粒子容量</dt>
                <dd>{effective.particleCapacity}</dd>
              </div>
              <div>
                <dt>Bloom</dt>
                <dd>{effective.bloom ? `开（×${effective.bloomScale}）` : '关'}</dd>
              </div>
              <div>
                <dt>阴影贴图</dt>
                <dd>{effective.shadows ? `${effective.shadowMapSize}²` : '关'}</dd>
              </div>
              <div>
                <dt>卡面纹理</dt>
                <dd>{effective.cardTier === 'battle' ? '战斗档' : '缩略图档'}</dd>
              </div>
            </dl>
          </section>

          {/* --- 战斗与演出 --- */}
          <section className="settings__panel" aria-label="战斗与演出">
            <h2 className="settings__title">战斗与演出</h2>

            <label className="settings__row" title="战斗台面：材质、配色、背景与雾一起换">
              <span className="settings__label">台面</span>
              <select
                className="settings__select"
                aria-label="战斗台面"
                value={tableThemeId}
                onChange={(e) => setTableTheme(e.target.value)}
              >
                {TABLE_THEMES.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings__row" title="相机视角；进入战斗后仍可自由旋转">
              <span className="settings__label">视角</span>
              <select
                className="settings__select"
                aria-label="相机视角"
                value={cameraModeId}
                onChange={(e) => setCameraMode(e.target.value as typeof cameraModeId)}
              >
                {CAMERA_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="settings__row" title="演出速度：只压缩播放时长">
              <span className="settings__label">演出</span>
              <span className="settings__segmented">
                {SPEED_LABELS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={
                      item.value === presentationSpeed
                        ? 'settings__seg settings__seg--on'
                        : 'settings__seg'
                    }
                    onClick={() => setPresentationSpeed(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </span>
            </div>

            <label className="settings__row settings__row--check" title="镜头震动">
              <input
                type="checkbox"
                checked={cameraShake}
                onChange={(e) => setCameraShake(e.target.checked)}
              />
              镜头震动
            </label>
            <label className="settings__row settings__row--check" title="冻结天气/视差（不移除）">
              <input
                type="checkbox"
                checked={reduceMotion}
                onChange={(e) => setReduceMotion(e.target.checked)}
              />
              减少动态
            </label>
            <label className="settings__row settings__row--check" title="开发用：帧耗时与 draw calls 读数">
              <input type="checkbox" checked={showPerf} onChange={(e) => setShowPerf(e.target.checked)} />
              显示性能读数
            </label>
          </section>

          {/* --- 声音 --- */}
          <section className="settings__panel" aria-label="声音">
            <h2 className="settings__title">声音</h2>
            <label className="settings__row">
              <span className="settings__label">主音量</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                className="settings__volume"
                aria-label="主音量"
                value={Math.round(masterVolume * 100)}
                onChange={(e) => setMasterVolume(Number(e.target.value) / 100)}
                onPointerUp={onVolumeRelease}
                onKeyUp={onVolumeRelease}
              />
              <span className="settings__value">{Math.round(masterVolume * 100)}%</span>
            </label>
            <div className="settings__row">
              <button
                type="button"
                className="settings__action"
                onClick={onPreviewSound}
                title="播放一声示例音效，确认音量生效"
              >
                试听
              </button>
              <span className="settings__note">
                音效由浏览器现场合成（起手 / 命中 / 死亡 / 抽卡 / 融合），不加载任何音频文件。
              </span>
            </div>
          </section>

          {/* --- 存档 --- */}
          <SaveSection profile={profile} store={store} cardCount={cardCount} />
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * 存档导入 / 导出。
 *
 * 文件 IO（`File.text()`）留在这一层，`previewImport` / `importProfile` 只吃字符串——
 * 这是 `legacyImport.ts` 早就定下的纪律，也是整条链路能在 node 里被测的原因。
 */
function SaveSection({
  profile,
  store,
  cardCount,
}: {
  readonly profile: ProfileState;
  readonly store: ProfileStore;
  readonly cardCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<readonly ImportFile[] | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    const text = await store.exportProfile();
    if (!text) {
      pushToast('存档还没就绪，稍后再试', 'error');
      return;
    }
    downloadJson(saveFileName(store.todayKey(), profile.schemaVersion, profile.revision), text);
    pushToast('已导出存档 JSON');
  };

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // 清空，允许再次选同一个文件
    event.target.value = '';
    if (files.length === 0) {
      return;
    }
    const read: ImportFile[] = await Promise.all(
      files.map(async (file) => ({ name: file.name, text: await file.text() })),
    );
    setPending(read);
    setPreview(store.previewImport(read));
  };

  const onConfirm = async () => {
    if (!pending) {
      return;
    }
    setBusy(true);
    const result = await store.importProfile(pending);
    setBusy(false);
    setPending(null);
    setPreview(null);
    if (result.ok) {
      // 导入可能换了整份存档（含设置），把 zustand 重新水合一次
      const imported = store.getSnapshot().profile;
      if (imported) {
        hydrateSettings(imported);
      }
      pushToast('存档已导入');
    } else {
      pushToast(`导入失败：${result.message}`, 'error');
    }
  };

  return (
    <section className="settings__panel" aria-label="存档">
      <h2 className="settings__title">存档</h2>

      <dl className="settings__readout">
        <div>
          <dt>落盘位置</dt>
          <dd>{store.getRepository().kind === 'indexeddb' ? 'IndexedDB' : '内存（降级）'}</dd>
        </div>
        <div>
          <dt>修订号</dt>
          <dd>{profile.revision}</dd>
        </div>
        <div>
          <dt>内容版本</dt>
          <dd>{profile.contentVersion}</dd>
        </div>
        <div>
          <dt>持有卡牌</dt>
          <dd>{cardCount} 张</dd>
        </div>
        <div>
          <dt>金币</dt>
          <dd>{profile.currencies.gold}</dd>
        </div>
      </dl>

      <div className="settings__row">
        <button type="button" className="settings__action" onClick={onExport}>
          导出 JSON
        </button>
        <button
          type="button"
          className="settings__action"
          onClick={() => inputRef.current?.click()}
        >
          导入 JSON…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          multiple
          hidden
          onChange={onPick}
        />
      </div>
      <p className="settings__note">
        导出的是完整存档（一份 JSON）。导入分两种：新版存档是**整份替换**；
        旧版 inventory / profile / deck 是**增量合并**，认不出来的项会在预览里逐条列出。
      </p>

      {preview && (
        <Modal
          title={preview.ok ? '导入预览' : '无法导入'}
          wide
          onClose={() => {
            setPreview(null);
            setPending(null);
          }}
          footer={
            preview.ok ? (
              <>
                <button
                  type="button"
                  className="settings__action"
                  onClick={() => {
                    setPreview(null);
                    setPending(null);
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="settings__action settings__action--primary"
                  disabled={busy}
                  onClick={onConfirm}
                >
                  {busy ? '导入中…' : '确认导入'}
                </button>
              </>
            ) : undefined
          }
        >
          <p className="settings__preview-message">{preview.message}</p>

          {preview.summary.length > 0 && (
            <>
              <h3 className="settings__subtitle">将会发生</h3>
              <ul className="settings__list">
                {preview.summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}

          {preview.warnings.length > 0 && (
            <>
              <h3 className="settings__subtitle">提示</h3>
              <ul className="settings__list">
                {preview.warnings.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}

          {preview.issues.length > 0 && (
            <>
              <h3 className="settings__subtitle">会被忽略 / 已修正</h3>
              <ul className="settings__list">
                {preview.issues.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}

          {preview.legacy.map((item) => (
            <div key={item.sourcePath}>
              <h3 className="settings__subtitle">{item.sourcePath}</h3>
              <p className="settings__note">
                认出 {item.mapped.length} 项
                {item.unknown.length > 0 ? `，${item.unknown.length} 项认不出来：` : '。'}
              </p>
              {item.unknown.length > 0 && (
                <ul className="settings__list settings__list--unknown">
                  {item.unknown.map((entry) => (
                    <li key={entry.rawPath}>
                      <code>{entry.rawPath}</code> —— {entry.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </Modal>
      )}
    </section>
  );
}
