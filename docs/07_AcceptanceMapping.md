# TCP R3 验收映射表

> 来源：`docs/01_Product.md`、`docs/02_Design.md`、`docs/03_Data.md`、`docs/04_UI.md`，R1/R2/R3 GitHub Issues/PRs，以及 Playwright E2E 视觉回归证据。
> 生成时间：2026-07-21
>  master SHA：`1344990b9e24d2980753763ef142d0f858dab541`

---

## 1. 验收维度说明

| 维度 | 说明 |
|---|---|
| 需求/页面 | `04_UI.md` 页面规格 + 对应 Issue/PR 验收标准中的条目 |
| 实现组件 | 前端 React 组件 / API 模块 / 类型定义 |
| 数据口径/API | `03_Data.md` 对象字段、`04_UI.md` 指标口径、后端 API 端点 |
| 单元测试/E2E | Vitest 单元测试文件、Playwright E2E 文件 |
| 截图资产 | Playwright 视觉回归基线 PNG（`tests/e2e/visual/*-snapshots/`） |
| PR/Commit | 合并 PR 编号与关键 commit SHA |

---

## 2. R1 全局框架（Issue #15 / PR #19）

| 需求/页面 | 实现组件 | 数据口径/API | 单元测试/E2E | 截图资产 | PR/Commit |
|---|---|---|---|---|---|
| 顶部导航：品牌 + 年度选择器 + 数据范围 | `frontend/src/App.tsx`、`YearContext.tsx`、`AppNavigation.tsx` | `GET /api/planning/available-years` 返回 `available_years` + `active_year` | `AppNavigation.test.tsx` | 所有 UI 截图均包含统一 Topbar | PR #19 `379b4a1` |
| 侧边栏为唯一业务导航 | `AppNavigation.tsx` | 角色-菜单矩阵：Member/Buddy/Leader/Admin 按权限叠加显示入口 | `AppNavigation.test.tsx` | UI-01~UI-05 截图左侧均显示 Sidebar | PR #19 `0e1c739` |
| 动态年度参数保留与回退 | `YearContext.tsx`、`yHref()` | `activeYear` fallback 链：URL → API → 当前年 | `AppNavigation.test.tsx` | — | PR #19 `d4c660c` |
| 全局 CSS tokens 与样式 | `frontend/src/styles.css` | 深蓝导航、浅灰蓝工作区、白色卡片、状态色 | — | 视觉回归全量通过 | PR #19 `379b4a1` |
| 共享 HTTP client 统一 | `frontend/src/shared/api.ts` | `request()` / `getOrNull()` 封装 | — | — | PR #19 `379b4a1` |

---

## 3. R2 Member 核心流程（Epic #16）

### 3.1 R2-A：我的成长看板 UI-01（Issue #20 / PR #23）

| 需求/页面 | 实现组件 | 数据口径/API | 单元测试/E2E | 截图资产 | PR/Commit |
|---|---|---|---|---|---|
| 年度计划进度环 + 状态统计 | `MemberDashboardPage.tsx`、`MemberDashboardPage.module.css` | `AnnualGrowthPlan` 状态：未开始/进行中/已完成/延期/暂停/取消；进度 = 已完成 ÷ 总数 | `MemberDashboardPage.test.tsx` | `member-dashboard.spec.ts-snapshots/*` | PR #23 `ceb2d22` |
| 四项学习时长指标 | `MemberDashboardPage.tsx` | `LearningProgressLog`：`actual_hours` 按 `record_date` 聚合；全年累计/当月累计/全年计划/当月计划 | `MemberDashboardPage.test.tsx` | 同上 | PR #23 `cc205ff` |
| 能力雷达图与 Gap 联动 | `MemberDashboardPage.tsx` | 六个启用域 P01/P02/P03/C01/C02/C03；`current_level` / `target_level` 均值 | `MemberDashboardPage.test.tsx` | 同上 | PR #23 `cc205ff` |
| 当前学习任务区域 | `MemberDashboardPage.tsx` | `LearningTask` 状态过滤：未完成/待 Review/延期 | `MemberDashboardPage.test.tsx` | 同上 | PR #23 `cc205ff` |
| Mock 数据开关 | `frontend/src/__fixtures__/memberDashboardMock.ts` | `VITE_ENABLE_MOCK` 环境变量 | `MemberDashboardPage.test.tsx` | 同上 | PR #23 `05795f5` |

### 3.2 R2-B：能力自评与 Gap UI-02（Issue #21 / PR #24）

| 需求/页面 | 实现组件 | 数据口径/API | 单元测试/E2E | 截图资产 | PR/Commit |
|---|---|---|---|---|---|
| L3 自评表（当前/目标掌握度） | `AssessmentGapPage.tsx`、`AssessmentGapPage.module.css` | `AssessmentDetail`：`current_level`、`target_level`、`gap_value` | `assessment.test.tsx`、`AssessmentGapPage` 相关测试 | `ui-02.spec.ts-snapshots/*` | PR #24 `d41763a` |
| Gap 侧栏（总数/均值/高优先级） | `AssessmentGapPage.tsx` | `Gap` = `target_level` − `current_level`；优先级 高/中/低 | `assessment.test.tsx` | 同上 | PR #24 `cc93fee` |
| Review 闭环前不可纳入计划 | `AssessmentGapPage.tsx` | `AssessmentReview` 状态：待复核/已闭环；结论「认可」才可 `plan_candidate` | `assessment.test.tsx` | 同上 | PR #24 `2000c94` |
| 内联自评依据编辑 | `AssessmentGapPage.tsx` | `AssessmentDetail`：`evidence_links`、`completion_scenario`、`notes` | `assessment.test.tsx` | 同上 | PR #24 `ea420df` |
| 能力域分组折叠 | `AssessmentGapPage.tsx` | `CapabilityDomainL1` 启用标识，不显示未来扩展域 | `assessment.test.tsx` | 同上 | PR #24 `a15e5f1` |

### 3.3 R2-C：年度成长计划与学习任务 UI-03（Issue #22 / PR #25）

| 需求/页面 | 实现组件 | 数据口径/API | 单元测试/E2E | 截图资产 | PR/Commit |
|---|---|---|---|---|---|
| 计划项列表 | `AnnualPlanTaskPage.tsx`、`AnnualPlanTaskPage.module.css` | `PlanItem`：`l3_code`、`target_level`、`estimated_hours`、`status` | `AnnualPlanTaskPage.test.tsx` | `ui-03.spec.ts-snapshots/*` | PR #25 `008ab83` |
| 1–12 月时间轴 | `AnnualPlanTaskPage.tsx` | `PlanItem.target_month` 聚合计数 | `AnnualPlanTaskPage.test.tsx` | 同上 | PR #25 `008ab83` |
| 学习任务详情抽屉 | `AnnualPlanTaskPage.tsx` | `LearningTask`：状态、实际起止日期、实际耗时、复盘结论、下步动作 | `AnnualPlanTaskPage.test.tsx` | 同上 | PR #25 `008ab83` |
| Evidence 版本历史 | `AnnualPlanTaskPage.tsx` | `Evidence` + `EvidenceReview`：版本号、提交时间、Review 结论 | `AnnualPlanTaskPage.test.tsx` / `evidence.test.ts` | 同上 | PR #25 `008ab83` |
| 学习执行日志 | `AnnualPlanTaskPage.tsx` | `LearningProgressLog`：`record_date`、`actual_hours`、`note` | `AnnualPlanTaskPage.test.tsx` | 同上 | PR #25 `008ab83` |
| 延期计划项展示 | `AnnualPlanTaskPage.tsx` | `PlanItem` 状态 = 延期 或 当前日期 > `plan_end_date` 且非已完成/取消 | `AnnualPlanTaskPage.test.tsx` | 同上 | PR #25 `008ab83` |

---

## 4. R3 补充页面（Epic #17）

### 4.1 R3-A：Buddy 复核中心 UI-04（Issue #27 / PR #29）

| 需求/页面 | 实现组件 | 数据口径/API | 单元测试/E2E | 截图资产 | PR/Commit |
|---|---|---|---|---|---|
| Buddy 导航入口 | `AppNavigation.tsx` | 角色含 `Buddy` 时显示「导师指导 → Buddy 复核中心」→ `/mentoring/dashboard` | `AppNavigation.test.tsx` | UI-04 截图左侧导航 | PR #29 `1cd1ea7` |
| 顶部统计（3 项） | `BuddyReviewCenter.tsx` | `GET /api/assessments/reviews/summary` + `GET /api/planning/evidence-reviews/summary` | `BuddyReviewCenter.test.tsx` | `ui-04-buddy-review-center-default-1440x900-chromium-linux.png` | PR #29 `48c9741` |
| 左侧成员选择器 | `BuddyReviewCenter.tsx` | `GET /api/auth/me` 返回 `assigned_members`；Buddy 仅可见负责成员 | `BuddyReviewCenter.test.tsx` | `ui-04-buddy-review-center-member-selected-*-chromium-linux.png` | PR #29 `1cd1ea7` |
| 复核队列（全部/自评/Evidence） | `BuddyReviewCenter.tsx` | `GET /api/assessments/reviews/pending` + `GET /api/planning/evidence-reviews/pending` | `BuddyReviewCenter.test.tsx` | 同上 | PR #29 `1cd1ea7` |
| 自评复核工作区 | `BuddyReviewCenter.tsx` 内联 | `GET /api/assessments/{id}` 返回 `AssessmentDetail` 逐项自评依据与 Gap | `BuddyReviewCenter.test.tsx` | `ui-04-buddy-review-center-assessment-*-chromium-linux.png` | PR #29 `1cd1ea7` |
| Evidence Review 工作区 | `BuddyReviewCenter.tsx` 内联 | `GET /api/planning/learning-tasks/{task_id}/evidence-reviews` | `BuddyReviewCenter.test.tsx` | `ui-04-buddy-review-center-evidence-*-chromium-linux.png` | PR #29 `1cd1ea7` |
| 复核结论与反馈校验 | `BuddyReviewCenter.tsx` | 自评：`认可` / `建议调整`（后者必填反馈）；Evidence：`通过` / `需补充` / `驳回`（后两者必填反馈） | `BuddyReviewCenter.test.tsx` | 同上 | PR #29 `1cd1ea7` |
| 反馈历史只读 | `BuddyReviewCenter.tsx` | `GET /api/assessments/{id}/history` + Evidence Review 历史 | `BuddyReviewCenter.test.tsx` | `ui-04-buddy-review-center-history-*-chromium-linux.png` | PR #29 `adf1d11` |
| 文案：复核/Review/反馈/建议 | `BuddyReviewCenter.tsx` | — | `BuddyReviewCenter.test.tsx` 断言无「审批」「批准」 | 同上 | PR #29 `1cd1ea7` |
| 权限隔离：非 Buddy 无权限 | `BuddyReviewCenter.tsx` | `useMe()` 角色校验 | `BuddyReviewCenter.test.tsx` / `tests/e2e/functional/four-role-core.spec.ts` | 同上 | PR #29 `1cd1ea7` |
| 单选按钮行布局 | `BuddyReviewCenter.tsx` | — | `BuddyReviewCenter.test.tsx` | `ui-04-buddy-review-center-assessment-*-chromium-linux.png` | PR #29 `4cee8df` |

### 4.2 R3-B：Leader 团队能力分析 UI-05（Issue #28 / PR #30）

| 需求/页面 | 实现组件 | 数据口径/API | 单元测试/E2E | 截图资产 | PR/Commit |
|---|---|---|---|---|---|
| Leader 导航入口 | `AppNavigation.tsx` | 角色含 `Leader` 时显示「团队运营 → 团队能力分析」→ `/operations/analytics` | `AppNavigation.test.tsx` | UI-05 截图左侧导航 | PR #30 `1344990` |
| Topbar 年度选择器 + 页面成员/能力域筛选 | `TeamAnalyticsPage.tsx` | `GET /api/planning/team-analytics?year=&member_id=&domain_code=` | `TeamAnalyticsPage.test.tsx` | 全部 UI-05 截图 | PR #30 `1344990` |
| 顶部 KPI（删除自评完成率） | `TeamAnalyticsPage.tsx` | `TeamAnalytics.kpis`：`plan_completion_rate`、`evidence_pass_rate`、`overdue_plan_item_count` | `TeamAnalyticsPage.test.tsx` 断言 `queryByText('自评完成率') === null` | 全部 UI-05 截图 | PR #30 `1344990` |
| 能力实际 vs 计划 | `TeamAnalyticsPage.tsx` | `domain_averages.actual` vs `domain_averages.target`；六个启用域 | `TeamAnalyticsPage.test.tsx` | `ui-05-team-capability-analysis-*-chromium-linux.png` | PR #30 `1344990` |
| 成员能力达成率热力表 | `TeamAnalyticsPage.tsx` | `member_attainment.attainment = actual / target × 100%`；target 为 0 显示「—」 | `TeamAnalyticsPage.test.tsx` | 同上 | PR #30 `1344990` |
| 计划完成趋势组合图 | `TeamAnalyticsPage.tsx` 内联 `TrendTable` | `monthly_trends.planned_count` / `actual_count` + `cumulative_planned_rate` / `cumulative_actual_rate` | `TeamAnalyticsPage.test.tsx` | 同上 | PR #30 `1344990` |
| 学习时长趋势组合图 | `TeamAnalyticsPage.tsx` 内联 `TrendTable` | `monthly_trends.planned_hours` / `actual_hours` + `cumulative_planned_hours` / `cumulative_actual_hours`，单位 `h` | `TeamAnalyticsPage.test.tsx` | 同上 | PR #30 `1344990` |
| 固定图例 | `TrendLegend.tsx` | 当月计划/当月实际/累计计划/累计实际 | `TeamAnalyticsPage.test.tsx` | 同上 | PR #30 `1344990` |
| 延期计划项明细 | `TeamAnalyticsPage.tsx` | `overdue_items`：成员、L3、`due_date`、`overdue_days`、状态 | `TeamAnalyticsPage.test.tsx` | `ui-05-team-capability-analysis-drawer-*-chromium-linux.png` | PR #30 `1344990` |
| 延期抽屉只读详情 | `TeamAnalyticsPage.tsx` | `PlanItem`：计划开始/结束日期、延期原因、下一步行动 | `TeamAnalyticsPage.test.tsx` 断言包含「只读」「计划开始日期」「计划结束日期」「延期原因」「下一步行动」 | 同上 | PR #30 `1344990` |
| 空态展示 | `TeamAnalyticsPage.tsx` | Mock 空数据：KPI 0%、暂无延期计划项 | `TeamAnalyticsPage.test.tsx` / `tests/e2e/visual/ui-05.spec.ts` | `ui-05-team-capability-analysis-empty-*-chromium-linux.png` | PR #30 `1344990` |
| 权限隔离：Member/Buddy/Admin 无权限 | `TeamAnalyticsPage.tsx` | `useMe()` 角色校验 | `TeamAnalyticsPage.test.tsx` / `tests/e2e/visual/ui-05.spec.ts` | 无截图（无权限页） | PR #30 `1344990` |
| 筛选器级联刷新 | `TeamAnalyticsPage.tsx` | `getTeamAnalytics()` 随 filter 重新请求 | `tests/e2e/visual/ui-05.spec.ts` member/domain/combined 截图 + `waitForResponse` | `ui-05-team-capability-analysis-member-*`、`ui-05-team-capability-analysis-domain-*`、`ui-05-team-capability-analysis-combined-*` | PR #30 `1344990` |
| 跨视口数值一致性 | `TeamAnalyticsPage.tsx` | 确定性 fixture 保证 1440×900 与 1280×800 KPI 文本一致 | `tests/e2e/visual/ui-05.spec.ts` cross-viewport 测试 | 同上 | PR #30 `1344990` |
| 不展示：雷达图/Gap 分布/泛化建议 | `TeamAnalyticsPage.tsx` | 页面仅含 04_UI.md 4.5 规定的 5 个区域 | `TeamAnalyticsPage.test.tsx` | 同上 | PR #30 `1344990` |

---

## 5. 测试基础设施（Issue #1 / PR #26）

| 需求/页面 | 实现组件 | 数据口径/API | 单元测试/E2E | 截图资产 | PR/Commit |
|---|---|---|---|---|---|
| Playwright E2E 框架 | `frontend/tests/e2e/`、`playwright.config.ts` | Docker Compose 启动 frontend/backend/postgres | `tests/e2e/**/*.spec.ts` | 全部 `*-snapshots/` | PR #26 `be0a150` |
| 视觉回归基线 | Playwright `toHaveScreenshot` | — | `tests/e2e/visual/*.spec.ts` | `tests/e2e/visual/*-snapshots/*.png` | PR #26 `be0a150` |
| CI E2E 工作流 | `.github/workflows/e2e.yml` | Playwright container `mcr.microsoft.com/playwright:v1.61.1-jammy` + `fonts-noto-cjk` | GitHub Actions E2E job | CI artifact 失败截图 | PR #30 `1344990` |
| 四角色核心路径 E2E | `tests/e2e/functional/four-role-core.spec.ts` | 登录 fixture + 角色路由权限 | `four-role-core.spec.ts` | — | PR #26 `be0a150` |
| Member 主流程 E2E | `tests/e2e/features/member-main-flow.spec.ts` | 自评 → Gap → 计划 → 任务 → Evidence | `member-main-flow.spec.ts` | — | PR #26 `be0a150` |

---

## 6. 关键 commit 与 CI 链接

| 阶段 | PR | 合并 Commit | 说明 |
|---|---|---|---|
| R1 全局框架 | PR #19 | `379b4a1aa6558354dd40b76caa98733f45833e20` | React Router + Layout + shared API + YearContext |
| R2-A UI-01 | PR #23 | `ceb2d2261713a85a77f0594e18ad6f515b5533fd` | Member Dashboard + CSS Modules |
| R2-B UI-02 | PR #24 | `d41763ae75f8d1b336d58e8310cf4428ee7a6793` | Assessment + Gap |
| R2-C UI-03 | PR #25 | `008ab83cb0b4c3e5261cc1d3268c3eebe220d3f6` | Annual Plan + Learning Task |
| Playwright/测试 | PR #26 | `be0a1508322ac0db1681a9c98a11499867b5ba92` | E2E + visual regression + CI |
| R3-A UI-04 | PR #29 | `1cd1ea7a85c61adb96a22cb5ce22ce5ef90ed25e` | Buddy Review Center |
| R3-B UI-05 | PR #30 | `1344990b9e24d2980753763ef142d0f858dab541` | Team Capability Analysis |

- GitHub Actions E2E workflow 文件：`.github/workflows/e2e.yml`
- 最终 master CI 运行链接：`https://github.com/yinhui198456/team-capability-platform/actions/workflows/e2e.yml`

### 6.1 最终 master commit CI 详情

| 项目 | 内容 |
|---|---|
| Commit SHA | `1344990b9e24d2980753763ef142d0f858dab541` |
| Commit 标题 | `R3-B: Leader 团队能力分析（UI-05）` |
| GitHub Actions Run URL | `https://github.com/yinhui198456/team-capability-platform/actions/runs/29798056585` |
| Workflow 结论 | ✅ success |
| 触发时间 | 2026-07-21T03:15:33Z |
| 开始时间 | 2026-07-21T03:15:36Z |
| 完成时间 | 2026-07-21T03:18:51Z |
| 运行时长 | ~3 分 15 秒 |
| 测试摘要 | 前端单元测试：88 项通过；Playwright E2E：41 项通过；视觉回归基线：42 张 PNG 通过比对；CI 步骤「Run E2E tests in Playwright container」结论 success |
| 失败截图上传 | 未触发（workflow success） |

---

## 7. 已关闭 Issue / Project 状态

| Issue | 标题 | 状态 | Project #3 状态 |
|---|---|---|---|
| #15 | Epic: R1 全局框架 | Closed | Done |
| #16 | Epic: R2 Member 核心流程 | Closed | Done |
| #17 | Epic: R3 补充页面 | Closed | Done |
| #20 | 6C-1: Member 工作台 UI-01 重构 | Closed | Done |
| #21 | 6C-2: 能力自评与 Gap UI-02 重构 | Closed | Done |
| #22 | 6C-3: 年度计划与学习任务 UI-03 合体 | Closed | Done |
| #27 | R3-A: Buddy 复核中心（UI-04） | Closed | Done |
| #28 | R3-B: Leader 团队能力分析（UI-05） | Closed | Done |
| #1 | [Testing] 引入 Playwright E2E 与视觉回归测试 | Closed | Done |

---

## 8. 备注

- 所有视觉回归截图已在 `mcr.microsoft.com/playwright:v1.61.1-jammy` 容器内重新生成，确保与 CI 渲染一致。
- `frontend/Dockerfile` 中 `npm ci` 已增加重试逻辑，缓解 esbuild `ETXTBSY` 瞬态失败。
- `.github/workflows/e2e.yml` 中 `npm ci` 已增加 `(npm ci || npm ci)` 重试逻辑，缓解 `ECONNRESET`。
