# Issue #201 · M02 阶段 1 原型方向

本目录集中维护 Issue #201 的三套可交互 HTML 原型候选。三套方案复用
`../prototype-v1/assets/index-Cw_G5jg6.css` 的 TCP 视觉变量与产品壳层，并共用本目录的
`assets/m02-options.css` 和 `assets/m02-options.js`；它们只比较布局，不复制业务逻辑。

## 入口

- [方案 1：行内展开](options/01-inline-expand.html)
- [方案 2：上下工作区](options/02-stacked-zones.html)
- [方案 3：左右工作台](options/03-side-workbench.html)
- [方案索引](index.html)

每套方案的 1440、1024、768 截图统一保存在 [`screenshots/`](screenshots/)；
最初的 AI 方向图保存在 [`references/`](references/)，仅说明布局意图，其中的重复控件、负数 Gap
或错误提示均不是业务合同。

## 原型边界

- 纯静态 HTML/CSS/JS，不连接 API，不保存到数据库。
- 评级、加入/移出计划、优先级、月份、保存和生成仅在浏览器内模拟。
- 业务示例固定使用 `null/0–5` 评级合同，Gap 不出现负数。
- 三套方案均按 1440、1024、768 Web 视口设计。
- 这些候选用于阶段 1 方向选择；用户选定后，阶段 2 只完善一个权威原型。

## 维护规则

1. 业务示例和交互只改 `assets/m02-options.js`。
2. TCP 公共视觉首先沿用 `prototype-v1`；本目录 CSS 只表达三种布局差异。
3. 用户未确认前，不替换 `prototype-v1/pages/m02-selected.html`。
4. 截图是审阅证据，不替代 HTML 原型或用户确认。
