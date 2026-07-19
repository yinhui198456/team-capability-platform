# 迭代 6 技术验收记录

> 本文件记录 UI-01～UI-05、角色边界和真实容器浏览器复验的实际结果；不代替用户集成 UAT，也不修改业务基线。

## 1. 验收范围

- Member：UI-01 我的成长看板、UI-02 自评/Gap、UI-03 年度计划/任务/Evidence。
- Buddy：UI-04 审核中心与 Evidence Review。
- Leader：UI-05 团队能力分析及筛选、KPI、组合图、延期明细。
- Admin：用户、角色与系统配置页面的可达性和权限边界。

## 2. 已执行验证与结果

| 检查 | 结果 |
|---|---|
| 前端回归 | 通过：19 个测试文件、119 个测试；build、lint、`git diff --check` 通过。 |
| 容器重建 | 通过：`docker compose up -d --build` 后 backend `/ready` 健康，前端可访问。 |
| 容器 smoke | 通过：`bash scripts/e2e-smoke.sh`。 |
| 四角色页面 | 通过：Member 7 页、Buddy 2 页、Leader 1 页、Admin 1 页均实际登录、打开并截图。 |
| 只读交互 | 通过：Member 能力域/月份筛选、Buddy 成员/队列切换、Leader 能力域筛选均通过；除登录会话外未发起业务写请求。 |
| 权限边界 | 通过：Member 直接访问 Leader 团队分析页被拒绝。 |

## 3. 浏览器复验页面

| 角色 | 页面 |
|---|---|
| Member | 我的成长、自评、评估历史、Gap、年度成长计划、学习任务、成长档案 |
| Buddy | Buddy 审核中心、Evidence Review |
| Leader | 团队能力分析 |
| Admin | 系统管理 |

## 4. 结论与剩余门禁

**Codex 技术验收通过。** 当前实现已在真实容器中完成只读业务流、关键原型区域和权限边界复验。

仍待用户执行的门禁：4-5、5-4、6A-4、6B-5、7-4。它们包含业务写入型 UAT 与最终发布决策，不能由本技术验收替代。

## 5. 可复现命令

```bash
docker compose up -d --build
bash scripts/e2e-smoke.sh
TCP_UIUX_PASSWORD=<approved-local-uat-password> python3 scripts/uiux-smoke.py
```

## 6. 6A-5 UI-01 Member 看板原型对齐修复

> 用户 UAT 反馈编号 6A-5，问题项：UI-01 Member 看板原型与主线未对齐。

### 6.1 问题摘要

- 学习时长单位应为 `h` 而非 `小时`，且字号需与原型一致。
- 雷达图/能力域筛选缺少颜色与中文描述。
- 待办事项排版、字号、图标与原型不符。
- 任务表格中任务名称、所属能力域/L3 未显示中文，且缺少带颜色的域徽章。

### 6.2 修复内容

- 后端 `backend/app/planning/repository.py`
  - 新增 `_get_l3_names` 辅助函数，通过 `capability_node` 表为 `gaps` 和 `current_tasks` 补充 `l3_name`。
- 前端类型 `frontend/src/planning.ts`
  - 为 `EligibleGap` 和 `LearningTask` 增加可选字段 `l3_name?: string | null`。
- 前端页面 `frontend/src/MemberDashboardPage.tsx`
  - 统一能力域中文名与颜色映射（P01 Data Infra、P02 AI Infra / Agent、P03 Coding、C01 基本办公、C02 沟通协作、C03 学习创新）。
  - 新增 `DomainBadge`、`formatHours`、`TodoItem` 组件。
  - 学习时长显示改为 `数字 + h` 样式。
  - 待办事项改为 4 列图标卡片：待提交 Evidence、待 Buddy 复核、计划到期、学习任务延期。
  - 雷达标签、能力域筛选、Gap 表格、任务表格均使用中文域徽章与 L3 中文名。
- 样式 `frontend/src/styles.css`
  - 补充 `.hours-value`、`.hours-number`、`.hours-unit`、`.todo-grid`、`.todo-item`、`.domain-badge`、`.gap-l3-name`、`.task-l3-name`、`.task-name-cell` 等样式。
- 单测 `frontend/src/MemberDashboardPage.test.tsx`
  - 更新 mock 与断言，覆盖中文 L3 名、`h` 单位、待办卡片文案。

### 6.3 修复后验证

- 关联 Issue：[#14](https://github.com/yinhui198456/team-capability-platform/issues/14)。
- 前端单测：17 个测试文件、106 个测试通过。
- 前端 lint：无错误。
- 前端 build：`tsc -b && vite build` 成功。
- 后端定向测试：容器中 `test_assessment.py`、`test_growth_goal.py`、`test_learning_task.py`、`test_member_dashboard.py`、`test_planning.py` 共 23 项通过。
- 后端 Ruff 与 Black：通过。
- 容器级 e2e-smoke 与视觉浏览器复验：尚未执行；仍需在部署环境中补充执行并完成用户 UAT。

### 6.4 剩余门禁

本修复完成后，UI-01 的 6A-5 问题已关闭，但仍需用户在实际容器环境中完成最终 UAT 签核。
