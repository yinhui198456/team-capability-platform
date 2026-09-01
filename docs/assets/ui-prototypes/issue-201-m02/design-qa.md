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
- [x] 文案与内容：移除职级要求；评级保持 0–5，Gap 不小于 0；评级/计划自动保存与显式生成继续隔离。
- [x] 状态与交互：评级自动保存中/已保存/失败、默认低优先级、缺月份错误、聚焦修复与生成成功均已覆盖。
- [x] 可访问性：显式 `<label for>`、`aria-invalid`、`aria-describedby`、可见焦点和减少动画偏好已覆盖。

## Evidence

- Source visual truth: `references/01-inline-expand-concept.png`（1585 × 992）。
- Existing TCP baseline: `../UI-02-assessment-gap.png`（历史视觉基线）与 `../prototype-v1/assets/index-Cw_G5jg6.css`（复用样式）；M02 差异样式与交互位于 `../prototype-v1/assets/m02-inline-expand.css` 和 `../prototype-v1/assets/m02-inline-expand.js`。
- Current browser-rendered implementation: `screenshots/01-inline-expand-hifi-1440x1024.png`（1440 × 1024）。
- Historical comparison: `qa/01-inline-expand-hifi-comparison.png` 与 `qa/01-inline-expand-alignment-before-after.png` 记录阶段 1 对齐过程，不作为当前交互文案真值。
- Responsive evidence: `screenshots/01-inline-expand-hifi-1440x1024.png`、`screenshots/01-inline-expand-hifi-1024x768.png`、`screenshots/01-inline-expand-hifi-768x900.png`。
- Viewport/state: deviceScaleFactor 1，桌面浅色状态，一个计划项已选、默认低优先级且月份完整；错误证据另含一个缺月份计划项。
- Primary interactions tested: 0–5 评级与自动保存状态、产生 Gap、加入/移出计划、可选优先级、必填月份、缺月份整批拦截、焦点定位和生成成功。
- Current browser coverage: Google Chrome headless；1440×1024、1024×768、768×900；旧方案 2/3 地址继续重定向到统一 M02。
- Console/page errors: 0。Horizontal overflow: 0。

## Comparison History

1. 初始审计发现 P1：月份控件比优先级下沉 22px；P2：状态/操作无统一基线、弃选入口仍可见、职级文案违背 M02 规格、1024px 操作条遮挡编辑区。
2. 修复：重构为固定标签/控件/反馈轨；状态与操作进入同一网格；移除弃选入口；改为 L3/目标等级文案；1180px 以下取消粘性操作条。
3. 复验：组合对照图确认桌面对齐；5 个视口、1 条完整交互链路、2 个弃选地址回退均为 0 失败。

final result: passed
