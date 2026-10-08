# 战斗技能动画

## 已下载的素材库

目录：`assets-library/battle-vfx/`。

- `LinearAbiltyCastingThreeJS.zip` 与 `linear-ability-casting/`：用户指定仓库完整归档。
  固定 commit：`97f1de19617e9a2e3af3c8021c8c21c8f58b40f3`；归档 SHA256 见 `linear-source.json`。
- `effekseer/`：官方当前现代 CC0 合集 10 包，全部保留 ZIP 和解压资源，
  共 291 个 .efkproj + 4 个 .efkefc，合计 295 个特效工程/效果文件。
  包名：Effekseer01、NextSoft01、Pierre01、Pierre02、MAGICALxSPIRAL、Suzuki01、
  AndrewFM01、tktk01、tktk02、HATO01。
- `effekseer/download-manifest.json`：每包 URL、大小与 SHA256。
  官方目录及子页面 HTML 已保存，记录许可来源。
- 原项目已有 `.gitignore` 规则排除 `assets-library/`；素材已经落盘，未改变该协作策略。
  运行时采用的少量资产位于 `public/assets/vfx/`，可以随游戏构建发布。

## 实际复用方式

1. MIT 仓库的 LightningMaterial 顶点/片元 Shader 移植到
   `src/rendering/effects/vendor/linearShaders.ts`：连续的相机朝向电弧带、核心/光晕双通道，
   端点固定、噪声折线与再次放电；移除源项目专用深度预处理依赖，并处理零长度方向。
2. ProceduralGeometry 的分段、弯曲晶体生成移植为 typed
   `vendor/linearCrystal.ts`；加上适配本项目的局部冰纹与霜层材质。
3. Effekseer MAGICAL X SPIRAL 的 Fire1.png 四乘四火焰序列贴图和 circle1.png 法阵贴图
   本地化为 `flame-atlas.png`、`magic-circle.png`；由 Three.js 原生材质播放。
4. 残影使用项目已有 `public/assets/ui/card_back.webp`。
   许可全文和素材来源随 `public/assets/vfx/THIRD-PARTY-NOTICES.txt` 提供。

完整 Effekseer .efkproj/.efkefc 保留作编辑与后续选用素材；本次没有接入 Effekseer WASM 播放器。
旧 .efkproj 需要在 Effekseer 编辑器中打开/导出后再用于该运行库。
本次的游戏运行时不下载在线资源，也不会把整个源仓库或 295 个效果装入首屏。

## 结构与资源优化

- 一套现有 Timeline 同时驱动粒子和三维几何，未增加另一套 RAF 或战斗时钟。
- 共享 6 种几何、按 URL 缓存少量纹理，低档最多 10 个、中/高档最多 24 个活跃几何演出。
  超预算先移除最旧视觉代理，不中断后续命中回调。
- 不在每帧重建几何、材质或向量；材质在演出完成后销毁，共用几何/纹理在场景卸载时释放。
- 同一群体演出仅触发一次 presentation onHit；正常结束、跳过、换画质都能释放代理。
- 跳过同时清除残留粒子；粒子预算仍使用原有 250/1000/3000 档。
- 事件适配传递技能 family，区分原来共用模板的效果；请求仍只读规则引擎已经确定的目标。
- 新演出跟随正常/快速/跳过速度设置。
- 删除约一千行已被替代的旧粒子模板；模板登记与实现分离。

## 协作说明

主要修改入口：

- `src/rendering/effects/SkillVisualPool.ts`：几何、材质、纹理与生命周期。
- `src/rendering/effects/skillRecipes.ts`：起手/飞行/命中/余波及群体粒子。
- `src/rendering/effects/templates.ts`、`familyMap.ts`：模板与技能族映射。
- `src/rendering/effects/EffectSystem.tsx`：与当前 Canvas/Timeline 集成。
- `src/rendering/presentation/eventEffects.ts`、`director.ts`：目标与速度适配。
- `src/scenes/EffectLabScene.tsx`：新模板预览入口。
