# Issue #201 · M02 高保真原型证据

本目录保留 Issue #201 的 M02 行内连续编辑截图、QA 与旧地址兼容入口。实际高保真原型已纳入统一 `prototype-v1`，复用其 TCP 视觉变量与产品壳层，不复制业务实现。

## 入口

- [统一定版索引（推荐）](../prototype-v1/index.html?collection=selected)
- [M02 行内连续编辑高保真原型](../prototype-v1/pages/m02-selected.html)

方案 1 的 1440、1024、768 高保真截图统一保存在 [`screenshots/`](screenshots/)；
最初的方向图与方案 2、3 历史证据仍保存在 Git 历史和本目录 QA 资产中，仅用于追溯。`index.html` 与 `options/` 下旧地址仅作兼容跳转。

## 原型边界

- 纯静态 HTML/CSS/JS，不连接 API，不保存到数据库。
- 评级自动保存、加入/移出计划、优先级、月份、计划草稿自动保存和生成仅在浏览器内模拟；不提供独立评级保存按钮。
- 加入计划时优先级默认「低」且可选改为中/高；计划月份仍为生成前必填项。
- 业务示例固定使用 `null/0–5` 评级合同，Gap 不出现负数。
- 方案 1 按 1440、1024、768 Web 视口设计。
- 方案 2、3 已停止维护；统一入口只展示方案 1。

## 维护规则

1. 业务示例和交互只改 `../prototype-v1/assets/m02-inline-expand.js`；行内编辑样式只改同目录的 `m02-inline-expand.css`。
2. TCP 公共视觉继续沿用 `prototype-v1/assets/index-Cw_G5jg6.css`。
3. 本目录只维护证据与兼容重定向，不新增第二个可编辑原型入口。
4. 截图是审阅证据，不替代 HTML 原型或用户确认。
