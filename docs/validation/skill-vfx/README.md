# 技能动画浏览器验证

验证时间：2026-10-06。实际 GPU：Intel Arc / ANGLE D3D11。
23 个模板在低/高档通过；无浏览器或 Shader 错误；跳过后粒子为 0。
真实浏览器快速/跳过的固定 seed 演示对局均为我方 7:0 胜利。

browser-results.json 为详细结果；PNG 为主要技能的暂停帧截图。

复现：在项目根目录启动 npm run dev，然后运行：

```powershell
node docs/validation/skill-vfx/validate.cjs
```

若使用其他端口，先设置 VFX_BASE_URL。脚本采用独立临时浏览器上下文，不读写用户浏览器存档。