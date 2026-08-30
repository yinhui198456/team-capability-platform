# Issue #201 · M02 阶段 1 高保真候选

本目录集中维护 Issue #201 的 M02 行内连续编辑高保真候选。原型复用
`../prototype-v1/assets/index-Cw_G5jg6.css` 的 TCP 视觉变量与产品壳层，交互与页面差异集中在
`assets/m02-options.css` 和 `assets/m02-options.js`，不复制业务实现。

## 入口

- [方案 1：行内连续编辑高保真候选](options/01-inline-expand.html)
- [方案索引](index.html)

方案 1 的 1440、1024、768 高保真截图统一保存在 [`screenshots/`](screenshots/)；
最初的方向图与方案 2、3 历史证据仍保存在 Git 历史和本目录 QA 资产中，仅用于追溯，不再作为候选入口。

## 原型边界

- 纯静态 HTML/CSS/JS，不连接 API，不保存到数据库。
- 评级、加入/移出计划、优先级、月份、保存和生成仅在浏览器内模拟。
- 业务示例固定使用 `null/0–5` 评级合同，Gap 不出现负数。
- 方案 1 按 1440、1024、768 Web 视口设计。
- 用户已放弃方案 2、3；方案 1 仍需用户确认后才成为阶段 1 输出。

## 维护规则

1. 业务示例和交互只改 `assets/m02-options.js`；方案 2、3 页面会回到方案 1。
2. TCP 公共视觉首先沿用 `prototype-v1`；本目录 CSS 只表达方案 1 的行内编辑差异。
3. 用户未确认前，不替换 `prototype-v1/pages/m02-selected.html`。
4. 截图是审阅证据，不替代 HTML 原型或用户确认。
