# Issue #65 全链路验收矩阵与 #64 UAT Backlog

> 本文件是 Issue #65（[P1][QA/UAT] 全链路回归、数据迁移演练与上线验收）的版本受控验收矩阵，同时承载 Issue #64 的 UAT backlog。
> 本文件仅做验收规划与状态记录，不定义或修改业务规则；业务规则以 `docs/01_Product.md` 至 `docs/05_Development.md` 为准。
> 除特别注明外，本文件所有验收项状态均为 **NOT RUN**，证据列留空；任何一行在真实执行并附可验证证据前不得标记为通过。

---

## 1. 规划基线（非通过证据）

- 初始规划基线：`6d42df1edd1f03384055624cc05f05d5cc6dbace`（分支 `feat/end-to-end-qa-uat-release-acceptance` 起始 HEAD）。
- 该 SHA 仅作为本矩阵的**初始规划基线**，用于锚定范围，**不构成任何 UAT 或验收已通过的证据**。
- 后续真实验收必须在执行时记录当时的最新完整 Head，并以该 Head 的实际证据为准。

## 2. 现状声明

1. **#63 UAT 仍为 backlog，未通过。** `docs/acceptance/ISSUE_63_ENGINEERING_CLOSEOUT.md` 第 5 节列出的 UAT 待办（Member 执行链界面走查、Buddy Evidence Review 走查、三视口人工走查、409 冲突恢复确认）均未执行。
2. **#64 自动化工程证据在同一基线 SHA 上已完整**（后端测试、前端门禁、E2E、三视口视觉基线，CI 全绿），但 **#64 UAT 未执行**，本文件第 3 节所有 #64 UAT 行均初始化为 NOT RUN，**任何一行不得标记为 passed**。
3. **轮次历史（如实记录）**：f26de364 轮为纯文档工作（新增本文件），未运行任何构建、测试、浏览器、容器或数据库命令；86a765b 轮新增 `backend/tests/issue65_support.py` 与契约测试，并实际运行了目录契约测试（13 passed）与一次本地 Backend 全量门禁（689 passed），使用保留的一次性本地 PostgreSQL 容器 `tcp-issue-65-pg-test`（仅合成数据）。**上述本地结果为 Claude 本地报告，不构成独立 GitHub 证据；规范整体门禁以同 SHA GitHub Actions 结果为准。**

## 3. #64 UAT Backlog（全部 NOT RUN）

统一列含义：身份/数据前置 = 执行该行走查所需的登录角色与数据准备；操作 = 精确执行动作；预期结果 = 通过判据；状态 = NOT RUN / PASS / FAIL；证据 = 截图、录屏或记录链接（执行后填写）。

### 3.1 G1 `/dashboard/member` Member 看板

| ID | 路由 | 身份/数据前置 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| UAT64-G1-01 | /dashboard/member | Member 登录；该 Member 有当前/目标职级与有效 Assessment | 打开看板 | 展示本人当前/目标职级；职级来源可追溯 | NOT RUN | |
| UAT64-G1-02 | /dashboard/member | Member 有多份 Assessment（含不适用职级组合） | 查看看板自评完成度 | 完成度只统计**适用于当前/目标职级**的 Assessment；不包含无关的固定 310 项 | NOT RUN | |
| UAT64-G1-03 | /dashboard/member | Member 同时存在必备 Gap 与进阶 Gap | 查看 Gap 区 | 必备与进阶 Gap 分离展示，计数与 Gap 列表一致 | NOT RUN | |
| UAT64-G1-04 | /dashboard/member | Member 存在正式 Growth Plan | 查看计划区 | 正式计划计数、状态分布与下一步行动（next action）正确展示 | NOT RUN | |

### 3.2 G2 `/growth/review/monthly` 月度复盘

| ID | 路由 | 身份/数据前置 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| UAT64-G2-01 | /growth/review/monthly | Member 有多个月度复盘记录 | 切换月份查看 | 每条复盘按 plan_month 正确归属，不错月 | NOT RUN | |
| UAT64-G2-02 | /growth/review/monthly | 当月有已完成任务 | 查看完成统计 | 当月完成任务计数正确 | NOT RUN | |
| UAT64-G2-03 | /growth/review/monthly | 当月有日志（含作废日志） | 查看工时统计 | 预估工时与有效实际工时分别展示；作废日志不计入有效实际工时 | NOT RUN | |
| UAT64-G2-04 | /growth/review/monthly | 存在延期、暂停、取消任务 | 查看任务状态分布 | 延期 / 暂停 / 取消相互分离统计，不混入完成 | NOT RUN | |
| UAT64-G2-05 | /growth/review/monthly | Member 登录 | 编辑成果、问题与下月重点并保存 | 三个字段可编辑、可保存，刷新后保留 | NOT RUN | |
| UAT64-G2-06 | /growth/review/monthly | 同一月份多次编辑 | 查看历史 | 历史版本保留、可查看，旧版本不被覆盖丢失 | NOT RUN | |

### 3.3 G3 `/growth/profile` 成长档案

| ID | 路由 | 身份/数据前置 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| UAT64-G3-01 | /growth/profile | Member 有完整闭环数据 | 打开成长档案 | 呈现 Assessment → Plan → Task → Evidence → Review 可追溯时间线 | NOT RUN | |
| UAT64-G3-02 | /growth/profile | 同上 | 查看条目详情 | 每条记录可看到版本与来源（source）信息 | NOT RUN | |
| UAT64-G3-03 | /growth/profile | Member 完成了某 Gap 对应任务 | 查看掌握度 | 任务完成**不自动提升**掌握度；掌握度变化只能来自新的 Assessment | NOT RUN | |

### 3.4 G4 `/operations/analytics` 团队能力分析

| ID | 路由 | 身份/数据前置 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| UAT64-G4-01 | /operations/analytics | Leader 登录；团队有多份 Assessment | 打开页面 | 明确展示 as_of / year / scope / source 口径 | NOT RUN | |
| UAT64-G4-02 | /operations/analytics | 团队存在必备与进阶 Gap | 查看 Gap 区 | 必备 Gap 与进阶 Gap 分离统计 | NOT RUN | |
| UAT64-G4-03 | /operations/analytics | Gap 含 Member 自填优先级 | 查看优先级分布 | 采用 Member 填报的优先级口径 | NOT RUN | |
| UAT64-G4-04 | /operations/analytics | 同时存在纳入与不纳入计划的 Gap | 查看纳计分布 | 正式纳入计划的统计口径正确 | NOT RUN | |
| UAT64-G4-05 | /operations/analytics | 团队有全年计划数据 | 查看分布区 | 季度 / 月份 / 状态 / 待验收 / 工时分布正确展示 | NOT RUN | |
| UAT64-G4-06 | /operations/analytics | 同上 | 应用筛选并对照明细 | 筛选条件、汇总数字与明细列表三者一致（filter-summary-detail reconciliation） | NOT RUN | |

### 3.5 G5 `/operations/team-annual-plan` 团队年度计划

| ID | 路由 | 身份/数据前置 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| UAT64-G5-01 | /operations/team-annual-plan | Leader 登录 | 使用既有管理操作 | 既有 Leader 管理动作（计划项管理）保持可用 | NOT RUN | |
| UAT64-G5-02 | /operations/team-annual-plan | 同上 | 查看主视图 | 只读正式 PlanItem 主视图正确展示 | NOT RUN | |
| UAT64-G5-03 | /operations/team-annual-plan | 团队有多名 Member | 使用成员筛选 | 成员筛选覆盖全团队范围（full-scope member filter） | NOT RUN | |
| UAT64-G5-04 | /operations/team-annual-plan | 数据跨多页 | 切换筛选与分页 | 汇总数字不随筛选/分页变化而失真（filter/pagination-invariant summary，按全集口径） | NOT RUN | |
| UAT64-G5-05 | /operations/team-annual-plan | 存在无法解析工时的计划项 | 查看工时区 | 展示预估工时范围，并对无法解析的项有明确披露 | NOT RUN | |
| UAT64-G5-06 | /operations/team-annual-plan | 存在作废日志 | 查看实际工时 | 有效实际工时不含已作废日志 | NOT RUN | |

### 3.6 G6 角色边界矩阵（单团队 MVP 口径）

> 已确认口径：当前产品为**单团队 MVP**。Member = 本人；Buddy = 当前被分配的 Member；Leader = 全部 Member；Admin = 与 Leader 相同的单团队只读范围。`buddy_relationship` 是辅导/评审指派关系，**不是团队隶属关系**。

| ID | 路由 | 身份/数据前置 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| UAT64-G6-01 | 全部 #64 路由 | Member 登录 | 访问各页面 | 仅看到本人数据；访问他人或 Leader/运营范围被拒 | NOT RUN | |
| UAT64-G6-02 | Buddy 相关路由 | Buddy 登录且有当前指派 | 查看指派 Member 数据 | 仅可见当前被指派的 Member；指派失效后不可见 | NOT RUN | |
| UAT64-G6-03 | /operations/* | Leader 登录 | 访问运营页面 | 可见全部 Member 的单团队范围数据 | NOT RUN | |
| UAT64-G6-04 | /operations/* | Admin 登录 | 访问运营页面 | 与 Leader 相同的单团队只读范围 | NOT RUN | |
| UAT64-G6-05 | Buddy 相关路由 | Buddy 登录但无指派关系 | 访问未指派 Member 数据 | 被拒绝；buddy_relationship 不被解释为团队隶属 | NOT RUN | |

### 3.7 G7 空态 / 历史 / 错误与恢复

| ID | 路由 | 身份/数据前置 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| UAT64-G7-01 | 全部 #64 路由 | 无任何业务数据的 Member | 打开各页面 | 空态可读、无报错、无误导性数字 | NOT RUN | |
| UAT64-G7-02 | 全部 #64 路由 | 含旧版本历史数据的账号 | 打开各页面 | 旧数据正确展示且历史不可变 | NOT RUN | |
| UAT64-G7-03 | 全部 #64 路由 | 未登录 | 直接访问路由 / API | 返回 401 并引导登录 | NOT RUN | |
| UAT64-G7-04 | 全部 #64 路由 | 登录但无权限角色 | 访问越权路由 / API | 返回 403，不泄露数据 | NOT RUN | |
| UAT64-G7-05 | 可写表单 | Member 登录 | 提交非法输入 | 返回结构化 422，错误定位可理解 | NOT RUN | |
| UAT64-G7-06 | 可写表单（CAS 场景） | 两端并发编辑同一记录 | 后提交一端保存 | 返回 409，**输入保留**，刷新 revision 后可由用户确认安全重试 | NOT RUN | |

### 3.8 G8 三视口视觉走查

| ID | 路由 | 身份/数据前置 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| UAT64-G8-01 | /dashboard/member | Member 登录，有代表性数据 | 1280×800、1440×900、1920×1080 逐视口走查 | 无页面横向溢出、控件不被裁剪、滚动不被阻断、筛选与输入不丢失 | NOT RUN | |
| UAT64-G8-02 | /growth/review/monthly | 同上 | 同三视口走查 | 同上 | NOT RUN | |
| UAT64-G8-03 | /growth/profile | 同上 | 同三视口走查 | 同上 | NOT RUN | |
| UAT64-G8-04 | /operations/analytics | Leader 登录，有代表性数据 | 同三视口走查 | 同上 | NOT RUN | |
| UAT64-G8-05 | /operations/team-annual-plan | Leader 登录，有代表性数据 | 同三视口走查 | 同上 | NOT RUN | |

## 4. 延期项（仅记录，不声明支持）

1. **UAT-DEF-01 与 #63 非生产性 polish**：仍为 backlog，本矩阵不覆盖、不声明已处理。
2. **CSV 导出**：仍为 backlog。#64 未新增任何导出端点或按钮，验收时不得期待该能力存在。
3. **多团队管理**：Medium 优先级未来工作。当前产品是**单团队 MVP，不支持也不声明跨团队隔离**。未来若要支持，范围必须显式包含：团队/成员/Leader 指派建模、存量数据迁移与回填、有界授权（bounded authorization）、跨团队拒绝测试、索引与查询评审、以及配套 UAT。

## 5. #65 全链路验收矩阵（全部 NOT RUN）

> 来源：GitHub Issue #65 正文（live）。执行时必须以当时的 Issue 正文与最新完整 Head 为准。

### 5.1 全链路场景

| ID | 范围 | 身份/数据前置 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| E2E-65-A | 场景 A：能力标准到自评 | Leader + Member；能力标准草稿 | Leader 创建/修改标准草稿并发布新版本；Member 查看本人相关矩阵；创建 Assessment 范围预览；创建并确认必备/进阶分类 | 版本发布可追溯；Member 仅见本人相关矩阵；范围预览正确；必备/进阶分类确认落库 | NOT RUN | |
| E2E-65-B | 场景 B：自评到 Buddy Review | Member + 当前指派 Buddy；有效 Assessment | 掌握度填写 0–5；填写优先级；选择纳入计划及季度/月；个人调整；保存草稿、冲突处理、提交与错误定位；Buddy 查看、建议调整、Member 修正、再次提交、认可 | 全链路字段与状态机正确；冲突可恢复；Buddy 闭环可追溯 | NOT RUN | |
| E2E-65-C | 场景 C：Review 到年度计划 | 已认可的 Assessment | 生成计划；重复调用生成 | 计划字段与 Assessment 一致；重复调用不产生重复项（幂等）；计划来源可追溯 | NOT RUN | |
| E2E-65-D | 场景 D：执行到复盘 | 正式计划与任务；Member + Buddy | 开始任务、写日志、累计耗时；提交证据；Buddy 要求补充与通过；完成任务；月度复盘统计；成长档案时间线；团队分析与团队年度计划汇总 | 执行闭环状态正确；汇总与明细一致；跨页面口径一致 | NOT RUN | |
| E2E-65-E | 场景 E：历史与新版本 | 已发布历史数据；新版本标准 | 发布能力标准新版本；核对历史 Assessment/Plan；创建新 Assessment；旧草稿按 #58 修复验证；演练迁移失败回滚 | 历史数据不可变；新 Assessment 使用新版本；迁移失败可安全回滚 | NOT RUN | |

### 5.2 测试数据组合（Issue #65「测试数据矩阵」18 项）

> 可执行 fixture 基础已落盘：`backend/tests/issue65_support.py`（18 维度命名案例目录 + 单团队合成身份与 Buddy 指派 + `materialize_identities` 构建器）与契约测试 `backend/tests/test_issue65_catalog.py`。
> 该目录仅证明覆盖性、唯一性、确定性与字段不变量；**目录构建不等于任何业务场景已执行或通过**，下表所有行仍为 NOT RUN。

| ID | 范围 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|
| DATA-65-01 | P4→P4 / P4→P5 / P4→P6 / P5→P6 职级组合 | 准备并执行各组合全链路 | 各组合行为符合能力模型 | NOT RUN | |
| DATA-65-02 | 目标职级缺失；当前/目标职级非法或倒退 | 构造并验证 | 校验拒绝并给出可理解提示 | NOT RUN | |
| DATA-65-03 | 显式标准目标、默认目标与不适用的 L3 | 构造并验证 | 三类目标口径各自正确 | NOT RUN | |
| DATA-65-04 | 旧草稿、建议调整、已提交、已复核、已归档各状态 | 构造并验证 | 各状态流转与展示正确 | NOT RUN | |
| DATA-65-05 | 无 Gap / 单项 Gap / 多项 Gap | 构造并验证 | 各形态汇总与明细正确 | NOT RUN | |
| DATA-65-06 | 高/中/低/暂缓优先级 | 构造并验证 | 优先级统计口径正确 | NOT RUN | |
| DATA-65-07 | 纳入计划与不纳入计划 | 构造并验证 | 两种选择各自正确落库与统计 | NOT RUN | |
| DATA-65-08 | Q1–Q4 与第 1–12 月 | 构造并验证 | 季度/月归属正确 | NOT RUN | |
| DATA-65-09 | 个人目标调整 | 执行调整 | 调整记录可追溯 | NOT RUN | |
| DATA-65-10 | Review 认可与建议调整 | 执行两种结论 | 两种结论流程各自正确 | NOT RUN | |
| DATA-65-11 | 计划生成、重复生成、执行、延期、暂停、取消、完成 | 执行全状态机 | 各迁移合法、非法迁移被拒 | NOT RUN | |
| DATA-65-12 | 多条日志、多条证据、通过与要求补充 | 构造并验证 | 聚合与版本历史正确 | NOT RUN | |
| DATA-65-13 | Member/Buddy/Leader/Admin 权限边界 | 逐角色越权尝试 | 边界与 3.6 节口径一致 | NOT RUN | |
| DATA-65-14 | 并发保存、提交、Review、发布、计划生成 | 并发执行 | 无脏写；冲突按 409 语义处理 | NOT RUN | |

### 5.3 自动化门禁

| ID | 范围 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|
| GATE-65-01 | Frontend | lint / format / build / 全量 unit | 全绿 | NOT RUN | |
| GATE-65-02 | Backend | Ruff / Black / 全量 pytest | 全绿 | NOT RUN | |
| GATE-65-03 | Backend Docker Test Stage | 构建并运行测试阶段 | 全绿 | NOT RUN | |
| GATE-65-04 | 数据库迁移 | up/down 或既定安全回滚演练 | 可安全执行与恢复 | NOT RUN | |
| GATE-65-05 | E2E | 全量 Playwright feature/smoke/visual | 全绿 | NOT RUN | |
| GATE-65-06 | 视觉 | 各关键页面 1280×800 / 1440×900 / 1920×1080 三视口 | 无回归 | NOT RUN | |
| GATE-65-07 | 权限 | 角色权限 E2E | 全绿 | NOT RUN | |
| GATE-65-08 | 并发 | 并发测试 | 全绿 | NOT RUN | |
| GATE-65-09 | 数据一致性 | 迁移前后一致性脚本 | 一致 | NOT RUN | |
| GATE-65-10 | 性能 | 查询性能基线 | 达到既定基线 | NOT RUN | |
| GATE-65-11 | CI | 最新完整 Head 的 GitHub Actions 全量 | 全绿 | NOT RUN | |

禁止行为（Issue #65 明确）：删除或 skip 失败测试；放宽视觉阈值掩盖回归；刷新无关页面基线；将未执行门禁写成通过；通过重新 seed 或删除历史数据获得绿色结果。

### 5.4 权限、并发与幂等专项

| ID | 范围 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|
| SEC-65-01 | 权限 | 跨角色越权访问全部关键路由/API | 401/403 语义正确、无数据泄漏 | NOT RUN | |
| SEC-65-02 | 并发 | 并发保存/提交/Review/发布/计划生成 | 状态机不被破坏；冲突可恢复 | NOT RUN | |
| SEC-65-03 | 幂等 | 重复提交、重复生成计划、网络重放 | 不产生重复记录 | NOT RUN | |

### 5.5 迁移演练（Issue #65 十步）

| ID | 范围 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|
| MIG-65-01 | 迁移演练 | 准备 UAT 结构与脱敏/备份数据 | 环境就绪 | NOT RUN | |
| MIG-65-02 | 迁移演练 | 执行迁移前完整备份并校验可读取 | 备份可验证 | NOT RUN | |
| MIG-65-03 | 迁移演练 | 记录表行数、约束与关键业务统计 | 基线记录完整 | NOT RUN | |
| MIG-65-04 | 迁移演练 | 执行迁移 | 迁移完成 | NOT RUN | |
| MIG-65-05 | 迁移演练 | 兼容诊断与数据一致性检查 | 无不一致 | NOT RUN | |
| MIG-65-06 | 迁移演练 | 迁移后执行全量测试 | 全绿 | NOT RUN | |
| MIG-65-07 | 迁移演练 | 演练回滚或按既定 forward-fix 策略验证恢复 | 恢复可验证 | NOT RUN | |
| MIG-65-08 | 迁移演练 | 确认旧历史不可变 | 历史记录未被改写 | NOT RUN | |
| MIG-65-09 | 迁移演练 | 输出耗时、磁盘与风险报告 | 报告归档 | NOT RUN | |

### 5.6 用户 UAT、部署与上线

| ID | 范围 | 身份/数据前置 | 操作 | 预期结果 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| UAT-65-M | 用户 UAT：Member | 已配置的非生产 UAT 角色身份与登录能力（UAT 地址与身份已存在，不再请求提供）；代表性职级组合取自第 5.2 节数据矩阵 | Member 视角验收：能力地图职级标准、自评范围非固定 310、必备/进阶分类、主表 7 字段、0–5/优先级/计划时间填写、无依据列与普遍依据门禁、提交与错误提示 | 用户明确通过 | NOT RUN | |
| UAT-65-B | 用户 UAT：Buddy | 同上 | Buddy 视角验收：识别重点 Gap/优先级/计划选择/个人调整；建议调整与认可流程；认可后计划正确生成 | 用户明确通过 | NOT RUN | |
| UAT-65-X | 用户 UAT：执行与复盘 | 同上 | 计划字段、任务/耗时/证据/复盘记录；月度复盘、成长档案与团队汇总一致 | 用户明确通过 | NOT RUN | |
| DEP-65-01 | UAT 部署 | 用户授权后 | 部署 UAT、健康检查、输出访问地址与账号清单 | 部署报告归档 | NOT RUN | |
| DEP-65-02 | 上线与回滚 | 用户授权后 | 形成上线与回滚 Runbook；按用户确认的上线窗口执行 | Runbook 与执行记录归档 | NOT RUN | |
| REV-65-01 | 最终独立验收 | 上述全部完成后 | ChatGPT 独立核对代码、测试、CI、截图与数据证据，发布最终验收 Review | Review 结论归档 | NOT RUN | |

## 6. 就绪度分级与授权边界

验收前必须区分三件事，不得混同：

1. **代码/门禁就绪**：同 SHA 的自动化测试与 GitHub Actions 全绿。
2. **运行环境就绪**：UAT 环境可访问、已配置的非生产角色身份可登录、只读健康检查通过。
3. **真实 UAT 执行授权**：用户明确授权启动某个具体 UAT 批次。

### 6.1 可后续正常推进的安全工程工作（无需额外授权，走正常开发流程）

- 编写测试数据脚本 / fixture、自动化测试与文档；
- 本地、非破坏性的检查与门禁运行（不涉及共享数据或 UAT 环境）；
- 修复集成缺陷的代码工作（对应 Codex 分工）。

### 6.2 环境就绪预检（允许，无需再次请求凭证）

- UAT 访问地址、非生产角色身份与相关环境配置**已存在，不得再次请求用户提供或粘贴**。
- 已配置的身份与登录能力可用于**只读 / 非破坏性**就绪预检（可达性、健康检查、登录可用性）。
- **绝不打印、复制或持久化**密码、token、cookie 或连接串；预检证据只记录非敏感事实（如"登录可用 / 不可用"）。
- 若登录不可用，只报告非敏感的缺失能力（如"某角色登录失败"），**不在对话中索要任何 secret**。
- Codex 依据**可验证的非破坏性 CC 预检证据 + 同 SHA GitHub 交付证据**独立评定环境就绪等级 A/B/C，不依赖用户口头"环境 OK"。
- **环境就绪 A 不代表 UAT 已执行或通过**；真实业务 UAT 在具体批次获授权前一律 NOT RUN，用户保留最终业务验收权。

### 6.3 必须获得用户**新鲜明确授权**后方可执行的动作

- 启动任何真实 UAT 批次；
- 对 UAT 数据的任何业务写入；
- 真实 UAT 部署、版本切换；
- 数据库备份、恢复、清理；
- 破坏性迁移 / 回滚操作；
- PR Ready、合并（merge）；
- 关闭任何 Issue；
- 生产部署、上线窗口确认；
- 回滚决定。

以上任何一项未获授权前，一律保持 NOT RUN / Draft 状态。

## 7. 本轮验证说明

本轮为**纯文档纠正**（仅本文件）：修正 UAT 身份前置与授权边界的过期表述，并如实更新轮次历史。仓库未提供已文档化的轻量 markdown/文档检查命令（CI 仅有 backend / frontend / e2e 三套工作流），因此**无适用的本地检查可运行**；本轮未运行任何构建、测试、容器或数据库命令。历史轮次的实际测试与门禁记录见第 2 节第 3 条。

## 8. 停点

**本文件仅为 #65 验收矩阵与 #64 UAT backlog 的规划落盘。所有验收项均为 NOT RUN，无任何通过证据。不得据此 Ready / merge / 部署 / 关闭 Issue。#66、#64、#72、#73 不在本轮范围。**
