# Findings: TCP Frontend Rescue R0 审计

## Routes & Architecture

| # | 问题 | 严重度 |
|---|------|--------|
| R1 | 无 React Router — 手写 pathname 匹配，所有导航全页刷新 | 🔴 |
| R2 | App.tsx 948 行，WorkspacePage 单体包含路由+导航+角色+页面映射 | 🔴 |
| R3 | 2 个页面组件内联在 App.tsx（400 行应提取为独立文件） | 🟡 |
| R4 | 4 条死路由：`/capability/gap`, `/growth/tasks`, `/mentoring/assessment-review`, `/mentoring/evidence-review` | 🟡 |
| R5 | 新增路由需改 3 处（whitelist + ternary + navigation） | 🟡 |

## Pages

| # | 问题 | 严重度 |
|---|------|--------|
| P1 | 无共享设计 token — domain colors 在两个文件中定义且值不同 | 🔴 |
| P2 | 年份硬编码 2026 — 所有 8 个 Member 页面 | 🟡 |
| P3 | 月度复盘严重残缺 — 只显示总时长，无产出/问题/下月重点 | 🔴 |
| P4 | 自评缺 L2 层级显示、无文件上传 | 🟡 |
| P5 | LearningTaskPage 640 行（最大页面），O(n) 请求串行 | 🟡 |
| P6 | 看板待办不携带筛选参数 | 🟢 |
| P7 | 成长档案无年份选择器和导出 | 🟡 |
| P8 | 各页面能力域中文名不一致 | 🟢 |

## API Layer

| # | 问题 | 严重度 |
|---|------|--------|
| A1 | **7 份重复的 request<T>()** — planning/assessment/gap/assessmentReview/system/access/catalog 各自实现 | 🔴 |
| A2 | 无共享 HTTP client 模块 | 🔴 |
| A3 | `createLearningTask()` 前端缺失（后端有此 endpoint） | 🟡 |
| A4 | 204 处理不一致 — 仅 planning.ts 有，其余 6 份无 | 🟡 |
| A5 | 同一领域对象定义了不同 TypeScript 类型（AssessmentReview vs CapabilityProfileAssessmentReview） | 🟢 |

## Styles (styles.css, 1517 行)

| # | 问题 | 严重度 |
|---|------|--------|
| S1 | **40+ 唯一 hex 值，零 CSS 变量** — 无法全局改色 | 🔴 |
| S2 | **57 个 TSX class 没有 CSS 规则** — 空壳或死代码 | 🟡 |
| S3 | **~15 个 CSS class 定义了但无 TSX 使用** — 僵尸样式 | 🟡 |
| S4 | 无全局 reset（box-sizing 逐组件设置，链接无默认颜色覆盖） | 🟡 |
| S5 | 单文件 1517 行，无 CSS modules/Tailwind/拆分 | 🟡 |
| S6 | 卡片样式模式重复 10+ 次，无共享 class | 🟡 |
| S7 | 中文 class name（`.status-进行中`、`.status-延期`） | 🟡 |
