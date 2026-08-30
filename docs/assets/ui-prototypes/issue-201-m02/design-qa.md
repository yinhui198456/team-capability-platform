# Issue #201 · M02 阶段 1 原型 Design QA

**Findings**

- 当前无可执行的 P0 / P1 / P2 差异。三套实现均保留各自概念图的核心布局关系，并统一回到 TCP 既有外壳、色板、间距和信息层级。
- P3：概念图中的字体细节和控件密度未逐像素复刻。该差异为有意选择：候选原型复用 `prototype-v1/assets/index-Cw_G5jg6.css`，避免建立第二套设计系统。

**Open Questions**

- 三套页面仍是阶段 1 候选，不是 M02 权威验收基线；需用户选择一种方向后才能进入阶段 2 规格细化。

**Implementation Checklist**

- [x] 字体与排版：沿用 TCP 系统字体、字号层级和表格密度，中文无异常截断。
- [x] 间距与布局：桌面、平板、窄屏均无水平溢出；主区域、选中态和操作区不重叠。
- [x] 色彩与视觉令牌：沿用 TCP 蓝色主色、成功/错误语义色、边框与阴影令牌。
- [x] 图片与资产：无新增装饰图片、伪图标、内联 SVG 或 CSS 绘图；仅保留概念图和浏览器证据图。
- [x] 文案与内容：统一使用 0–5 评级，Gap 不小于 0；“保存评级”与“生成任务”结果明确分离。
- [x] 状态与交互：评级、加入/移出计划、优先级、计划月份、保存、缺失月份拦截和生成成功均已验证。
- [x] 可访问性：语义按钮/表单标签、键盘焦点、状态播报、替代文本和减少动画偏好已覆盖。

## Evidence

- Source visual truth:
  - `references/01-inline-expand-concept.png`（1585 × 992）
  - `references/02-stacked-zones-concept.png`（1487 × 1058）
  - `references/03-side-workbench-concept.png`（1487 × 1058）
- Browser-rendered implementation:
  - `qa/01-inline-expand-implementation-1536x1024.png`
  - `qa/02-stacked-zones-implementation-1536x1024.png`
  - `qa/03-side-workbench-implementation-1536x1024.png`
- Full-view combined comparisons:
  - `qa/01-inline-expand-comparison.png`
  - `qa/02-stacked-zones-comparison.png`
  - `qa/03-side-workbench-comparison.png`
- Responsive evidence: each option has `1440x1024`、`1024x768`、`768x900` captures under `screenshots/`.
- Viewport/state: implementation CSS viewport 1536 × 1024, deviceScaleFactor 1, desktop light theme, one plan item selected. Source concepts have different native dimensions, so `qa/compare.html` places both artifacts in equal-width 600px-high `object-fit: contain` frames; comparison is structural rather than pixel-precise.
- Focused regions: not required for this low-fidelity direction decision. The full-view paired evidence keeps navigation, rating controls, Gap, plan fields, and primary actions readable; the 768px captures separately verify responsive behavior.
- Primary interactions tested: rate 0–5, create Gap, add/remove plan, select priority/month, save ratings, reject missing month, generate selected tasks.
- Browser coverage: Google Chrome headless at 1536×1024, 1440×1024, 1024×768 and 768×900; 3 options × 4 viewports plus 3 complete interaction flows.
- Console/page errors: none. Horizontal overflow: none.

## Comparison History

1. Initial responsive inspection found two P2 issues at 768px: the inherited prototype CSS hid the text-only index link, and scheme 1's sticky action bar obscured content.
2. Fix: added explicit full/short index labels and changed the narrow-screen action bar to normal document flow.
3. Post-fix evidence: all three `screenshots/*-768x900.png` captures show a readable “方案索引”; scheme 1 no longer has a floating action panel covering rows. The repeated browser check reports zero failures.

final result: passed
