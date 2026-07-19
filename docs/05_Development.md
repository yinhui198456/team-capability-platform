# 05 Development

## 1. 文档定位与边界

本文档把已冻结的 `01_Product`、`02_Design`、`03_Data`、`04_UI` 转换为 MVP 技术实施方案。它只定义技术边界、模块契约、验收方式和迭代顺序，不实现业务功能，不定义物理数据库表或 SQL。

### 1.1 已确认基线

| 项目 | 冻结范围 |
|---|---|
| 部署 | 私有化单实例；单团队；人数少于 10 人 |
| 专业线 | 技术架构与开发专业线；启用 P01/P02/P03/C01/C02/C03 六个能力域 |
| 角色 | Member、Buddy、Leader、Admin；User : Role 为 N:M，权限叠加 |
| 业务闭环 | 能力模型 → Assessment → Gap → Growth Goal → Annual Growth Plan → Plan Item → Learning Task → Evidence → Review → Capability Profile |
| 页面形态 | Web 工作台；不建设 LMS、移动端、独立消息中心或复杂监控 |
| 历史规则 | Assessment、Evidence、Review 保留版本和闭环历史；旧版本不可直接回流 |

### 1.2 技术建议与假设

| 层 | MVP 推荐 | 性质 |
|---|---|---|
| 前端 | React + TypeScript + Ant Design Pro / ProComponents | 技术栈建议，待确认脚手架选择 |
| 后端 | FastAPI + Python | 技术栈建议 |
| 数据库 | PostgreSQL | 技术栈建议 |
| 运行方式 | Docker Compose 编排前端、FastAPI、PostgreSQL | 与单实例边界匹配的部署建议 |
| 前端质量 | ESLint + Prettier | 工程质量建议 |
| Python 质量 | Ruff + Black | 工程质量建议 |
| API 风格 | 面向页面和业务对象的 REST/JSON 契约 | 实施建议，不提前锁定外部集成 |

技术假设：MVP 使用平台内置账号；不默认接入外部 IAM/SSO、IM、邮件、对象存储、多团队、移动端或复杂监控。任何此类集成需另行确认。

## 2. MVP 架构

推荐采用浏览器 → React Web → FastAPI → PostgreSQL 的单体服务边界；Docker Compose 只负责本地和私有单实例编排。Evidence 文件在存储方案确认前只抽象为链接/文件引用，不在本阶段决定具体对象存储。

### 2.1 前端目录与模块边界

| 目录 | 责任 | 不应承担 |
|---|---|---|
| `frontend/src/app` | 应用入口、布局、全局路由、主题 | 业务数据拼装 |
| `frontend/src/pages` | 页面容器，按 02/04 页面组织 | 直接访问数据库或绕过 API |
| `frontend/src/components` | ProComponents 表格、表单、时间轴、状态标签等复用视图 | 决定角色权限 |
| `frontend/src/services` | REST 请求、错误归一化、分页参数 | 渲染和状态机决策 |
| `frontend/src/models` | 页面所需类型、查询状态、表单草稿状态 | 物理表结构镜像 |
| `frontend/src/access` | 有效角色叠加后的页面/操作可见性 | 替代后端授权 |
| `frontend/src/styles` | 视觉基线与响应式样式 | 引入新的视觉体系 |

### 2.2 后端目录与模块边界

| 目录 | 责任 | 不应承担 |
|---|---|---|
| `backend/app/main.py` | FastAPI 应用组装与健康入口 | 业务规则散落 |
| `backend/app/api` | 路由、请求/响应契约、分页和错误码 | 直接拼 SQL |
| `backend/app/schemas` | API 输入输出模型 | 页面专属渲染逻辑 |
| `backend/app/services` | Assessment、Gap、Plan、Task、Evidence、Analytics 等业务用例 | HTTP 细节 |
| `backend/app/policies` | 角色叠加、数据范围、年度计划门禁 | 前端展示判断 |
| `backend/app/repositories` | 逻辑对象的持久化访问抽象 | 重新定义业务状态 |
| `backend/app/imports` | 能力模型与学习资源的只读导入适配 | 修改冻结业务规则 |
| `backend/app/config` | 环境配置与运行参数 | 业务默认值硬编码 |

前端只能通过 API 访问后端；页面组件不得依赖 repositories；后端 policies 必须是授权最终裁决点；任何物理数据库设计在本阶段之外。

## 3. 逻辑对象、API、权限与页面映射

下表是高层契约，不是表结构。API 名称用于任务拆分，实际路径和字段需在开发前形成可审阅的 API 合同。

| 逻辑对象 | 高层 API 能力 | 数据范围/操作权限 | 页面 |
|---|---|---|---|
| User | 用户查询、个人资料维护 | Member 本人；Admin 管理；其他角色按范围查看 | `/system/users`、个人中心 |
| Role | 角色分配与权限查看 | Admin 管理；User : Role 为 N:M；权限取并集 | `/system/roles` |
| Buddy Relationship | 辅导关系查询/维护 | Admin 配置；Buddy 查看负责成员 | `/system/users`、`/mentoring/dashboard` |
| Capability Model / Domain L1 / Item L2 / Item L3 | 模型查询、导入、Leader 维护 | Leader 维护；Member/Buddy 查看；Admin 全量查看 | `/capability/model` |
| Learning Resource | 资源查询与维护 | Leader 维护；其他角色按范围查看 | `/operations/resources` |
| Assessment / Assessment Detail | 草稿、提交、历史快照 | Member 维护本人；Buddy 复核负责成员；Leader 按团队查看；Admin 全量查看 | `/capability/assessment`、`/capability/assessment/history` |
| Assessment Review | 自评复核记录创建、反馈、闭环查询 | Buddy 对负责成员指导、复核、反馈；Member 查看本人历史；Admin 全量查看但不因 Admin 身份自动获得 Buddy Review 权限 | `/mentoring/assessment-review`、`/mentoring/feedback` |
| Gap | Gap 计算、优先级、纳入计划标记 | Member 维护本人；Buddy 提供指导；Leader 查看团队；Admin 全量查看 | `/capability/gap`、`/growth/goals` |
| Growth Goal | Gap 纳入后的年度目标查询/维护 | Member 维护本人；其他角色按范围查看 | `/growth/goals` |
| Annual Growth Plan | 年度计划生成、状态、统计 | Member 维护本人；其他角色按范围查看；生成受统一门禁约束 | `/growth/annual-plan` |
| Plan Item | L3 计划项查询与执行管理 | Member 维护本人；Buddy/Leader 按范围查看；一个 L3 计划项对应一个 Learning Task | `/growth/annual-plan` |
| Learning Task | 任务状态、日期、完成判定 | Member 维护本人；Buddy/Leader 按范围查看 | `/growth/tasks`、`/growth/review/monthly` |
| Learning Progress Log | 日志新增/编辑/查询与时长聚合 | 字段固定为 `task_id`、`record_date`、`actual_hours`、`note`、`recorder`；Member 维护本人，Buddy/Leader 按范围查看，Admin 全量查看；仅聚合时长，不改变任务关系或状态 | `/growth/tasks`、`/growth/review/monthly`、`/dashboard/member`、`/operations/analytics` |
| Evidence | 草稿、提交、版本历史 | Member 维护本人；历史版本只读；Buddy Review 负责成员；Leader/Admin 按范围查看 | `/growth/tasks`、`/growth/profile` |
| Evidence Review | Review 队列、结论、反馈、闭环历史 | Buddy 对负责成员执行；Member 查看本人；Leader/Admin 按范围查看；Admin 不因全量查看而自动成为 Review 执行者 | `/mentoring/evidence-review`、`/mentoring/feedback` |
| Team Annual Capability Plan | 团队年度能力规划发布/归档 | Leader 维护；团队范围查看 | `/operations/team-annual-plan` |
| Capability Profile | 年度成长档案聚合查询 | Member 本人；Buddy 负责成员；Leader 团队；Admin 全量 | `/growth/profile` |
| System Config | 年度窗口、首页待办、默认周期等参数查询/维护 | Admin 管理；不建设独立消息中心 | `/system/settings` |

### 3.1 年度计划生成门禁

以下原文在前后端均作为同一业务策略使用：

**正式将 Gap 纳入年度成长计划（包括生成年度成长计划及其计划项）的统一门禁：当前 Assessment 最新一次提交对应的 Assessment Review 已闭环，Review 结论为「认可」，且不存在待复核事项。**

门禁前 Gap 仍立即可见、可筛选、可设置优先级；门禁只约束正式纳入年度成长计划及生成 Plan Item。后端策略拒绝不满足条件的写入，前端同时展示原因；不得只依赖前端禁用。

### 3.2 权限叠加

Member 只能维护本人数据；Buddy 查看负责成员并执行指导、复核、Review、反馈；Leader 查看团队数据并维护能力模型、资源和团队规划；Admin 拥有全量数据查看与系统管理权限。Admin 的业务操作权限仍按其附加的 Member、Buddy、Leader 角色叠加获得，不自动获得业务 Review 或计划维护权限。

## 4. 路由、状态与原型绑定

### 4.1 路由清单

| 路由 | 页面 | 主要角色 | 原型 |
|---|---|---|---|
| `/dashboard/member` | 我的成长看板 | Member | UI-01 |
| `/capability/model` | 能力模型 | 全员按权限 | 无固定主原型 |
| `/capability/assessment` | 能力自评 | Member | UI-02 |
| `/capability/gap` | Gap 分析 | Member / Buddy | UI-02 |
| `/capability/assessment/history` | 评估历史 | Member / Buddy | UI-02 历史区 |
| `/growth/goals` | 成长目标 | Member | UI-02 / UI-03 衔接 |
| `/growth/annual-plan` | 年度成长计划 | Member | UI-03 |
| `/growth/tasks` | 学习任务 | Member | UI-03 |
| `/growth/review/monthly` | 月度复盘 | Member / Buddy / Leader | UI-01 / UI-03 数据入口 |
| `/growth/profile` | 成长档案 | Member | UI-03 结果衔接 |
| `/mentoring/dashboard` | 辅导成员看板 | Buddy | UI-04 |
| `/mentoring/assessment-review` | 自评复核 | Buddy | UI-04 |
| `/mentoring/evidence-review` | Evidence Review | Buddy | UI-04 |
| `/mentoring/feedback` | 反馈记录 | Buddy / Member | UI-04 历史区 |
| `/operations/resources` | 学习资源 | Leader | 无固定主原型 |
| `/operations/analytics` | 团队能力分析 | Leader | UI-05 |
| `/operations/team-annual-plan` | 团队年度能力规划 | Leader | 无固定主原型 |
| `/system/users` | 用户管理 | Admin | 无固定主原型 |
| `/system/roles` | 角色权限 | Admin | 无固定主原型 |
| `/system/settings` | 系统配置 | Admin | 无固定主原型 |

原型路径固定为：`docs/assets/ui-prototypes/UI-01-my-growth-dashboard.png`、`UI-02-assessment-gap.png`、`UI-03-annual-plan-task.png`、`UI-04-buddy-review-center.png`、`UI-05-team-capability-analysis.png`。

| 原型 | 主路由/页面 | 实际资产路径 |
|---|---|---|
| UI-01 | `/dashboard/member` / 我的成长看板 | `docs/assets/ui-prototypes/UI-01-my-growth-dashboard.png` |
| UI-02 | `/capability/assessment`、`/capability/gap` / 能力自评与 Gap 分析 | `docs/assets/ui-prototypes/UI-02-assessment-gap.png` |
| UI-03 | `/growth/annual-plan`、`/growth/tasks` / 年度成长计划与学习任务 | `docs/assets/ui-prototypes/UI-03-annual-plan-task.png` |
| UI-04 | `/mentoring/dashboard`、`/mentoring/assessment-review`、`/mentoring/evidence-review` / Buddy 复核中心 | `docs/assets/ui-prototypes/UI-04-buddy-review-center.png` |
| UI-05 | `/operations/analytics` / 团队能力分析 | `docs/assets/ui-prototypes/UI-05-team-capability-analysis.png` |

### 4.2 状态与交互契约

| 对象 | 状态/转移 | 核心交互 |
|---|---|---|
| Assessment | 草稿 → 待复核 → 已复核或建议调整 → 已归档；调整后新提交产生新的 Review 记录 | 保存草稿、提交、查看 Gap、查看历史 |
| Assessment Review | 待复核 → 已闭环；结论为认可/建议调整 | Buddy 复核、反馈、闭环；历史记录不重复流转 |
| Annual Growth Plan | 制定中 → 执行中 → 已归档 | 通过门禁后生成/维护年度计划 |
| Plan Item | 未开始、进行中、已完成、延期、暂停、取消 | 按 L3 维护计划月份、预计时长和状态 |
| Learning Task | 未开始、进行中、待 Evidence Review、已完成、延期、暂停、取消 | 执行、填写日志、提交 Evidence |
| Evidence | 草稿 → 待 Review → 通过/需补充/驳回 → 已归档；补充或重提创建新版本 | 旧版本只读，不直接回流 |
| Evidence Review | 待 Review → 通过/需补充/驳回 → 已闭环 | Buddy 提交结论与反馈，旧 Review 不回流 |
| Learning Progress Log | 无独立状态 | 仅新增/编辑本人记录并按 `record_date` 聚合 `actual_hours` |

## 5. 演示种子数据规范

种子数据只用于本地演示和截图验收，不包含代码、SQL 或实际插入脚本。

- 组织：一个团队、8 名团队成员以内；另设 1 个 Admin 账号，合计仍少于 10 个账号。固定角色为 Member、Buddy、Leader、Admin，允许 Leader/Buddy 兼任 Member 以演示权限叠加。
- 能力模型：六个启用域 P01 Data Infra、P02 AI Infra / Agent、P03 Coding、C01 基本办公、C02 沟通协作、C03 学习创新；每域准备可展开的 L2/L3 示例，未来扩展域不放入可操作数据。
- 资源与规划：为 L3 准备少量 Learning Resource 索引，并准备一份 Leader 发布的 Team Annual Capability Plan；两者只用于演示页面和关联关系，不引入课程生命周期。
- 评估：至少准备一个最新提交且 Assessment Review 已闭环、结论为认可的 Member；另准备一个待复核或建议调整的 Member，用于演示计划门禁阻塞。所有 Assessment 保留历史版本。
- Gap/Goal/Plan：认可成员准备多个不同优先级 Gap、Growth Goal、年度计划、L3 Plan Item；同一 Plan Item 只派生一个 Learning Task。
- 任务/日志：准备未开始、进行中、待 Evidence Review、已完成、延期等任务；每个任务准备多条 `Learning Progress Log`，覆盖不同月份与小时数，使 UI-01、UI-03、UI-05 能展示全年/当月计划与实际时长。
- Evidence/Review：至少准备草稿、待 Review、通过、需补充、驳回及已归档版本；补充/驳回必须对应新版本和新的 Review 历史。
- 团队分析：跨成员准备实际 vs 计划、成员达成率、计划完成趋势、学习时长趋势和延期计划项明细所需的聚合数据。

## 6. 端到端验收场景

### 6.1 分阶段 UAT

每个业务纵向切片在 Codex 验收通过后进入用户 UAT：用户基于可操作的演示环境执行该切片的核心流程并给出反馈。UAT 是该迭代的最终门禁之一；UAT 未通过时，只修复当前迭代已授权范围内的缺陷或体验问题，不借机新增业务规则、不扩大原型范围、不提前启动后续迭代。最终端到端 UAT 集中在迭代 7 执行。

| 场景 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|
| Member 主线 | Member 有六域评估和 Gap；最新 Review 已认可 | 提交自评 → 查看 Gap → 选入计划 → 补充计划信息 → 执行 Learning Task → 提交 Evidence | 计划项、任务、Evidence、档案关联完整；一个 Plan Item 仍只有一个 Learning Task |
| Buddy 自评复核 | Buddy 负责该 Member，Assessment Review 待复核 | 打开 `/mentoring/assessment-review`，查看依据，提交认可或建议调整 | Review 形成闭环历史；建议调整不影响 Gap 查看，但阻止正式纳入计划 |
| 计划门禁阻塞/解除 | 最新 Assessment Review 待复核或结论非认可 | 在 `/growth/goals` 尝试纳入 Gap；完成 Buddy Review 认可后重试 | 阻塞时 API 拒绝并返回原因；解除后可生成 Annual Growth Plan/Plan Item |
| 学习时长聚合 | Learning Task 关联多条日志 | 在 `/growth/tasks` 新增不同日期、小时数日志，查看看板/月度复盘 | 仅按 `record_date` 聚合 `actual_hours`；不创建子任务、不改变任务状态 |
| Evidence Review | Evidence 已提交待 Review | Buddy 在 `/mentoring/evidence-review` 提交通过/需补充/驳回 | Review 闭环；需补充/驳回要求新 Evidence 版本，旧版本只读 |
| Leader 团队分析 | 多成员有评估、计划、日志、Evidence、延期项 | 打开 `/operations/analytics`，切换年度/成员/能力域 | UI-05 四类图表和延期明细口径正确；Leader 不可编辑成员业务数据 |
| Admin 范围 | Admin 账号可登录；是否附加业务角色分别准备两种数据 | 查看全量并进入系统管理；无 Buddy 角色时尝试 Review | Admin 可全量查看和管理用户/角色/配置；业务操作只由附加角色授权 |
| 原型截图 | 种子数据已加载 | 对五条固定主路由截图并与实际 PNG 对照 | UI-01 四项时长+能力/GAP/任务；UI-02 L3+Gap+门禁；UI-03 计划项/月轴/详情/Evidence；UI-04 成员/队列/工作区/历史；UI-05 实际 vs 计划/达成率/月累计趋势/延期明细均可见 |

## 7. 分迭代开发计划

| 迭代 | 内容 | 门禁 |
|---|---|---|
| 0 | 文档与契约校验：对象、状态、权限、路由、原型路径、门禁原文 | 01–04 交叉校验通过；不写业务代码 |
| 1 | 前后端壳工程、Compose、质量工具、健康入口、空页面路由 | 容器可启动；无业务页面实现 |
| 2 | 能力模型只读展示与 Excel 导入边界；学习资源只读 | 六域和 L3 层级可追溯 |
| 3 | **3A**：MVP 本地会话、演示账号与有效角色、Buddy 关系与后端权限基础，仅满足单团队 UAT 运行条件，不含 Admin 管理页；**3B**：Assessment、Assessment Review、Gap 与年度计划生成门禁，绑定 UI-02 及 UI-04 自评复核子流程 | 3A 门禁：本地会话、演示账号/角色、Buddy 关系、权限基础可运行；3B 进入门禁：3A 经 Codex 审核通过；3B 验收门禁：自评/复核/Gap/门禁阻塞与解除场景通过，并完成切片 UAT |
| 4 | Growth Goal、Annual Growth Plan、Plan Item、Learning Task、Learning Progress Log | 绑定 UI-03 的 Goal/计划/任务/日志子流程；1:1 任务关系和时长聚合场景通过，并完成该切片 UAT |
| 5 | Evidence 版本、Evidence Review、成长档案聚合 | 绑定 UI-03 的 Evidence 区、UI-04 的 Evidence Review 区及成长档案；旧版本不回流、Review 历史闭环，并完成该切片 UAT |
| 6 | **6A**：UI-01 我的成长看板，以及 UI-02～UI-04 的成员/Buddy 视觉与交互整合；**6B**：UI-05 团队能力分析、Leader 能力模型/学习资源维护与团队年度能力规划、Admin 用户/角色/系统设置管理，以及有效角色权限验收 | 6A 进入门禁：迭代 5 验收通过；6A 验收门禁：UI-01 与 UI-02～UI-04 视觉交互整合通过；6B 进入门禁：6A 通过；6B 验收门禁：五张原型截图与集成 UAT 通过 |
| 7 | 种子数据、端到端回归、容器重启、日志与文档硬化 | 端到端场景全通过；完成最终 UAT/发布决策 |

### 7.1 子阶段说明

- **3A 只提供必要的本地会话、演示账号、有效角色、Buddy 关系与后端权限基础**，用于支撑后续切片的单团队 UAT 运行；Admin 管理页（用户管理、角色权限、系统配置）不在 3A，留到 6B 与 Leader 维护功能一起验收。
- **3B 依赖 3A**，完成 Assessment、Assessment Review、Gap 与年度计划生成门禁，绑定 UI-02 及 UI-04 自评复核子流程。
- **6A 依赖迭代 5**，完成 UI-01 以及 UI-02～UI-04 的成员/Buddy 视觉与交互整合。
- **6B 依赖 6A**，完成 UI-05、Leader 已确认的能力模型/学习资源维护与团队年度能力规划、Admin 已确认的用户/角色/系统设置管理，以及有效角色权限验收。
- **只有 6A 与 6B 均完成后，五张原型截图和集成 UAT 才通过。**

### 7.2 风险与缓解

| 风险 | 缓解 |
|---|---|
| 文档规则漂移 | 每次迭代先跑对象/状态/路由契约检查；变更先回到 01–04 |
| 前端绕过门禁 | 后端统一策略校验，前端仅做提示和禁用 |
| 多角色越权 | 权限测试覆盖角色并集、数据范围和 Admin 无附加业务角色场景 |
| Evidence/Review 历史回流 | 以版本号和闭环状态做服务层验证；旧记录只读 |
| 日志重复聚合或时区口径不一致 | 统一 `record_date` 和 `actual_hours` 聚合契约；在月度/年度验收中核对样例 |
| 原型与页面漂移 | 固定 PNG 路径和五条截图验收清单；不自行增加模块 |
| 外部集成扩大范围 | 将 IAM/SSO、对象存储、IM、邮件、多团队、移动端、复杂监控列为单独决策，不在 MVP 隐式加入 |

## 8. 已确认技术选择

以下选择已确认，作为后续工程初始化的技术基线；备选方案仅作延后评估记录，不属于当前 MVP 决策。

| 选择 | 已确认方案 | 延后备选 | 影响 |
|---|---|---|---|
| React 工程脚手架 | Vite + React + TypeScript + Ant Design Pro/ProComponents | Ant Design Pro 官方 Umi 模板（延后评估） | 当前采用轻量 Vite；Umi 仅在后续需要更强 Pro 官方约定时评估 |
| MVP 账号会话 | HttpOnly Cookie 本地会话 | JWT 短时访问令牌（延后评估） | Cookie 与单实例 Web 匹配；JWT 留待未来多服务场景评估 |
| Evidence 文件引用 | 单实例本地持久卷 | S3 兼容对象存储（延后评估） | 当前不引入外部对象存储；扩展部署规模时再评估迁移影响 |

本阶段仍不替用户决定 SSO/IAM、外部通知、多团队、移动端或复杂监控，也不创建物理数据库表、API 实现或业务页面代码。

## 9. E2E 与视觉回归测试

为减少人工对照原型图的测试时间，前端引入 Playwright 作为 E2E 与视觉回归层，与现有 vitest 单元测试互补。

### 9.1 目录与命令

- 配置：`frontend/playwright.config.ts`
- 测试目录：`frontend/tests/e2e/`
  - `fixtures/` — 登录等共享辅助。
  - `smoke/` — 环境健康与核心接口烟雾测试。
  - `visual/` — UI-01 ~ UI-05 原型页视觉回归测试。
- 常用命令：
  - `npm run test:e2e:install` — 安装 Chromium 浏览器。
  - `npm run test:e2e` — 默认对 http://localhost:18081 运行全部 E2E 测试，并自动启动 Docker Compose。
  - `PLAYWRIGHT_NO_WEBSERVER=1 npm run test:e2e` — 复用已启动的本地容器。
  - `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_NO_WEBSERVER=1 npm run test:e2e` — 对 Vite dev server 运行。
  - `npm run test:e2e:update-snapshots` — 更新视觉回归基线截图。
  - `npm run test:e2e:ui` / `npm run test:e2e:debug` — UI 模式与调试模式。

### 9.2 测试策略

| 层级 | 工具 | 覆盖目标 |
|---|---|---|
| 单元测试 | vitest | 组件渲染、API mock、权限分支 |
| 烟雾测试 | Playwright | 容器启动、登录、6 个能力域、核心页面可达 |
| 视觉回归 | Playwright screenshots | UI-01 ~ UI-05 原型页布局、字号、颜色、图标 |
| 功能 E2E | Playwright | Member/Buddy/Leader/Admin 核心只读与写入路径 |

### 9.3 基线管理

- 视觉基线截图纳入版本管理，路径约定为 `frontend/tests/e2e/visual/**/__snapshots__/`。
- 更新 UI 后通过 `npm run test:e2e:update-snapshots` 重新生成基线，并在 PR 中单独说明截图变更原因。
- CI 失败时上传 `test-results/` 与 `playwright-report/` artifact，便于排查像素差异。

### 9.4 数据隔离

- E2E 测试复用 Docker Compose 的演示种子数据，不单独创建测试数据库。
- 写入型测试按角色使用固定演示账号，避免跨测试状态污染；必要时在测试前后通过 API 重置目标对象状态。
