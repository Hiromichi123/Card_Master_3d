# 战斗技能动画替换记录

日期：2026-10-06。修改范围：技能特效、事件到特效的适配、特效实验台，以及专项测试与素材登记。
没有修改 domain 战斗规则、卡牌数值、存档、商店、地图、卡面/台面或依赖版本。

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

## 原有与缺失表现核查

原版已有 13 个粒子模板，35 个技能族均有映射，但视觉以同一类柔圆光点为主。
“映射存在”不等于每个技能已有独立动画。

| 项目 | 原表现/问题 | 当前处理 |
| --- | --- | --- |
| 火球/群体火球 | 粒子点模拟弹体 | 立体弹体、火焰序列贴图、弧线拖尾、命中火焰与扩散环 |
| 冰封/群体冰封 | 冰色粒子 | 立体晶体围绕目标生长、局部冰纹/霜层、碎屑与消退 |
| 闪电/群体闪电 | 用很多散点拼线 | MIT 连续 Ribbon Shader，核心/光晕双层、闪烁/重击，减少散点开销 |
| 治愈/群体治愈 | 群体映射到单体，额外目标被忽略 | 单独群体模板；对全部确定目标显示法阵、生命符号、上升粒子 |
| 自疗/自增益 | 适配器排除了施法者本人 | 保留真实自身目标；无目标兜底位于卡面，不是偏出的施法起点 |
| 破甲/闪避 | 共用普通护盾 | 破甲壳层崩解、闪避卡背残影分别展示 |
| 吸血 | 共用紫色减益粒子 | 红色生命流从受击者流回施法者 |
| 爆裂/自毁 | 共用普通火球或减益 | 专用死亡爆破/自毁模板 |
| 还魂/不死/复活 | 共用转移粒子 | 法阵升起、卡背残影与返回反馈 |
| 分身/复制 | 共用转移粒子，没有 CloneCreated 表现 | 独立残影模板，接入 CloneCreated 的实际槽位 |
| 加速/延迟 | 共用转移粒子 | 旋转时钟/冷却反馈，接入技能导致的 CooldownChanged |
| 沉默 | 共用状态光点 | 专用紫色封印与叉形符号 |
| 祝福/振奋、诅咒、抽卡/转移、普通攻击、状态提示 | 原有基础模板 | 共用新几何/时间轴，保留对应族映射 |

现在有 23 个可手动预览的模板。实验台仍显示卡牌本身已解析的技能，可直接查看同一技能的
单体/群体、参数、播放时长、原色/自定义颜色，以及暂停和跳过。
未知/未实现的战斗规则没有自动补入；本次补的是已有技能所缺的演出。

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

## 验证

- 类型检查通过。
- 全部 119 项单元测试通过，其中 5 项新增验证覆盖：
  群体回调一次、跳过/完成回收、容量上限、并发端点隔离、自疗/群体治疗目标。
- 生产构建通过。现有应用大 bundle 的 Vite 提示仍存在，本轮不改全局打包策略。
- 实际浏览器使用 Intel Arc / ANGLE D3D11（当时把 GPU 型号与逐项结果写进了
  `docs/validation/skill-vfx/browser-results.json`，该目录的截图与 JSON 已在
  2026-10-07 清理；结论保留在本节）。
- 逐项验证过火球、冰封、闪电、群体治愈、破甲、吸血与还魂/复活。
- 低/高档全部 23 模板通过；快速与跳过完整对局都以我方 7:0 胜利、本体生命归零结束，结果一致。跳过后活跃粒子为 0。

## 协作说明

开始时 Git 工作区干净；首次应用修改前，对七个已有文件比较 SHA256，
确认没有同时被 Claude 改动后再应用。没有修改依赖锁文件、全局配置或进度清单。
没有提交 commit，也没有发送消息给其他任务。

主要修改入口：

- `src/rendering/effects/SkillVisualPool.ts`：几何、材质、纹理与生命周期。
- `src/rendering/effects/skillRecipes.ts`：起手/飞行/命中/余波及群体粒子。
- `src/rendering/effects/templates.ts`、`familyMap.ts`：模板与技能族映射。
- `src/rendering/effects/EffectSystem.tsx`：与当前 Canvas/Timeline 集成。
- `src/rendering/presentation/eventEffects.ts`、`director.ts`：目标与速度适配。
- `src/scenes/EffectLabScene.tsx`：新模板预览入口。
