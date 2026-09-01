# Issue #132 · 阶段 1 高保真交互原型

本目录是 Issue #132 的阶段 1 用户评审候选。它沿用当前能力地图视觉基线，以纯静态 HTML/CSS/JavaScript 演示 URL/Hash、L1/L2/L3 定位、搜索、浏览器历史与键盘操作；不连接 API、数据库或运行环境，也不修改产品代码。

## 评审入口

- 打开 [`index.html`](index.html)。推荐从静态文件服务器访问，以便刷新、后退和前进与真实页面一致。
- 直接输入以下地址可检查深链接：
  - `index.html#P02`
  - `index.html#P02.02`
  - `index.html#P02.02.08`
  - `index.html#P02.02.99`（可识别能力域，但路径不存在）
  - `index.html#NOT-A-CODE`（完全无效路径）
- 在搜索框输入 `P02.02.08`、`Agent / 应用链开发与发布` 或 `P02.02`，使用方向键、Enter 与 Escape 操作。

## 阶段 1 包

- [`requirements.md`](requirements.md)：#132 与 #52/#153/#161/#162、`docs/04_UI.md` 的统一验收矩阵。
- [`ui-skills-audit.md`](ui-skills-audit.md)：Product Design、frontend-skill、frontend-design、frontend-dev、ui-ux-pro-max 的专业审查记录。
- [`design-qa.md`](design-qa.md)：与仓库能力地图视觉基线的浏览器截图对照和交互 QA。
- `qa/`：阶段 1 浏览器证据；截图仅为证据，不能替代 HTML 原型或用户确认。

## 权威边界

本原型只定义 Issue #132 的拟议可见行为。业务对象和页面语义仍以 `capability-model/`、`docs/01_Product.md`～`docs/05_Development.md` 为准。用户在阶段 2 确认后，本目录与需求矩阵才成为后续实现基线。
