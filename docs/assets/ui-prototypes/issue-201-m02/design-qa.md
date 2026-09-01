# Issue #201 · M02 方案 1 高保真 Design QA

**Findings**

- 当前无可执行的 P0 / P1 / P2 差异。
- P3：方向概念图把标签与控件横向混排；高保真实现采用标签在上、控件在下的稳定字段轨。该差异是有意修正，提升了窄屏可读性和字段关系清晰度。

**Approved Prototype**

- 唯一推荐入口：[`../prototype-v1/pages/m02-selected.html`](../prototype-v1/pages/m02-selected.html)；本目录截图与 QA 文件仅作为审阅证据。

**Implementation Checklist**

- [x] 字体与排版：沿用 TCP 系统字体和层级，标签、控件、状态、操作共享基线。
- [x] 间距与布局：使用统一间距轨道；1440、1024、768、375 与 900×375 无横向溢出。
- [x] 色彩与令牌：沿用 TCP 蓝色主色和成功/错误语义色，未引入第二套视觉系统。
- [x] 图片与资产：无新增装饰图片、伪图标、内联 SVG 或 CSS 绘图。
- [x] 文案与内容：移除职级要求；评级保持 0–5，Gap 不小于 0，三个业务动作继续分离。
- [x] 状态与交互：空态、保存成功、缺月份错误、聚焦修复与生成成功均已验证。
- [x] 可访问性：显式 `<label for>`、`aria-invalid`、`aria-describedby`、可见焦点和减少动画偏好已覆盖。

## Evidence

- Source visual truth: `references/01-inline-expand-concept.png`（1585 × 992）。
- Existing TCP baseline: `../UI-02-assessment-gap.png`（历史视觉基线）与 `../prototype-v1/assets/index-Cw_G5jg6.css`（复用样式）；M02 差异样式与交互位于 `../prototype-v1/assets/m02-inline-expand.css` 和 `../prototype-v1/assets/m02-inline-expand.js`。
- Browser-rendered implementation: `qa/01-inline-expand-hifi-implementation-1536x1024.png`（1536 × 1024）。
- Full-view combined comparison: `qa/01-inline-expand-hifi-comparison.png`。
- Focused comparison: `qa/01-inline-expand-alignment-before-after.png`；直接显示月份控件修复前下沉 22px、修复后与优先级同基线。
- Responsive evidence: `screenshots/01-inline-expand-hifi-1440x1024.png`、`screenshots/01-inline-expand-hifi-1024x768.png`、`screenshots/01-inline-expand-hifi-768x900.png`。
- Viewport/state: CSS viewport 1536 × 1024，deviceScaleFactor 1，桌面浅色状态，一个计划项已选且月份完整。概念图原生尺寸不同，通过 `qa/compare.html` 在等宽、600px 高的 `object-fit: contain` 画框中做结构对照，不声称逐像素一致。
- Primary interactions tested: 0–5 评级、产生 Gap、加入/移出计划、优先级、月份、保存评级、缺月份整批拦截、焦点定位和生成成功。
- Browser coverage: Google Chrome headless；1440×1024、1024×768、768×900、375×812、900×375；旧方案 2/3 地址重定向也已验证。
- Console/page errors: 0。Horizontal overflow: 0。

## Comparison History

1. 初始审计发现 P1：月份控件比优先级下沉 22px；P2：状态/操作无统一基线、弃选入口仍可见、职级文案违背 M02 规格、1024px 操作条遮挡编辑区。
2. 修复：重构为固定标签/控件/反馈轨；状态与操作进入同一网格；移除弃选入口；改为 L3/目标等级文案；1180px 以下取消粘性操作条。
3. 复验：组合对照图确认桌面对齐；5 个视口、1 条完整交互链路、2 个弃选地址回退均为 0 失败。

final result: passed
