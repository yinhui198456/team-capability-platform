# 06 Roadmap

> TCP 唯一项目进度面板。本文件只记录进度与验收证据，不定义或修改业务规则。唯一基线为 `docs/01_Product.md` 至 `docs/05_Development.md`。
>
> 阅读顺序：`README.md` → `01_Product.md` → `02_Design.md` → `03_Data.md` → `04_UI.md` → `05_Development.md` → 本文件。

---

## 1. 状态定义

| 状态 | 含义 | 进入条件 |
|---|---|---|
| 待开始 | 已排入迭代计划，尚未分配 CC 执行 | 上一迭代门禁通过或用户明确启动 |
| 进行中 | 已分配 CC，正在开发或文档修订 | 迭代启动会或用户授权开始 |
| 待用户确认 | 工作已完成评审，但需要用户决策才能推进 | 用户决策阻塞点 |
| 已完成 | 该迭代门禁通过，证据已归档 | 迭代验收通过 |
| 已阻塞 | 因依赖、范围或技术问题暂停 | 出现明确阻塞并记录原因 |

更新原则：只在迭代开始、门禁通过、阻塞发生或用户决策后更新本文件，不实时同步日常提交。

---

## 2. 迭代进度主表（迭代 0 至 7）

范围与门禁取自 `docs/05_Development.md` 第 7 节，未新增范围。

| 迭代 | 范围 | 当前状态 | 进入门禁 / 验收门禁 | 当前证据或下一动作 |
|---|---|---|---|---|
| 0 | 文档与契约校验：对象、状态、权限、路由、原型路径、门禁原文 | 已完成 | 门禁：01–04 交叉校验通过；不写业务代码 | 基线文档已冻结：`docs/01_Product.md`、`02_Design.md`、`03_Data.md`、`04_UI.md`、`05_Development.md`；五张原型图位于 `docs/assets/ui-prototypes/UI-01-my-growth-dashboard.png`、`UI-02-assessment-gap.png`、`UI-03-annual-plan-task.png`、`UI-04-buddy-review-center.png`、`UI-05-team-capability-analysis.png`；关键 commit `9a0d482`（docs: track frozen TCP baseline） |
| 1 | 前后端壳工程、Compose、质量工具、健康入口、空页面路由 | 已完成 | 门禁：容器可启动；无业务页面实现 | 后端 `backend/app/main.py` 提供 `/health`、`/ready`；`compose.yaml` 编排 PostgreSQL / FastAPI / Nginx 前端；质量工具配置齐全（Ruff、Black、ESLint、Prettier）；关键 commit `bbcfaef`（chore: initialize TCP engineering scaffold） |
| 2 | 能力模型只读展示与 Excel 导入边界；学习资源只读 | 已完成 | 门禁：六域和 L3 层级可追溯 | 后端 `backend/app/catalog/importer.py` 从固定 Excel 导入六个 MVP 域（P01/P02/P03/C01/C02/C03）；`backend/app/catalog/repository.py` 提供只读查询；`backend/app/catalog/api.py` 暴露 `GET /api/capability-model`、`GET /api/learning-resources`；前端 `frontend/src/App.tsx` + `frontend/src/catalog.ts` 实现 `/capability/model` 与 `/operations/resources` 匿名只读页；测试覆盖导入、API、E2E、数据库隔离；关键 commit 范围 `c43e0d4..9550bff` |
| 3 | **3A**：MVP 本地会话、演示账号/有效角色、Buddy 关系与后端权限基础，仅满足单团队 UAT 运行条件，不含 Admin 管理页；**3B**：Assessment、Assessment Review、Gap 与年度计划生成门禁，绑定 UI-02 及 UI-04 自评复核子流程 | 已完成 | 3A 进入门禁：迭代 2 验收通过；3A 验收门禁：本地会话、演示账号/角色、Buddy 关系、权限基础可运行；3B 进入门禁：3A 经 Codex 审核通过且用户 UAT 确认；3B 验收门禁：自评历史、Review 闭环、阻塞/解除场景通过，且该切片 UAT 通过 | **3A 已完成**；**3B 全部子任务完成并通过测试**（后端 127 passed，前端 32 passed），用户确认 3B UAT 通过。关键 commit：3B-1 `b67dd6d..7171f4b`，3B-2 `235a882..306cca0`，3B-3 `611d3c7..2c77a98`，3B-4 `754020d..8d23b68`；验收记录 `docs/acceptance/ITERATION_3B_TECHNICAL_ACCEPTANCE.md`。 |
| 4 | Growth Goal、Annual Growth Plan、Plan Item、Learning Task、Learning Progress Log | 待用户确认 | 进入门禁：迭代 3 验收通过；验收门禁：1:1 任务关系和时长聚合场景通过，且该切片 UAT 通过 | 4-1～4-4 实现和技术验收完成；4-5 用户 UAT 待执行。原型绑定 UI-03 的 Goal/计划/任务/日志子流程。 |
| 5 | Evidence 版本、Evidence Review、成长档案聚合 | 待用户确认 | 进入门禁：迭代 4 验收通过；验收门禁：旧版本不回流、Review 历史闭环，且该切片 UAT 通过 | 5-1～5-3 实现和技术验收完成；5-4 用户 UAT 待执行。4-5 延后不阻塞已获授权的实现。 |
| 6 | **6A**：UI-01 我的成长看板，以及 UI-02～UI-04 的成员/Buddy 视觉与交互整合；**6B**：UI-05 团队能力分析、Leader 能力模型/学习资源维护与团队年度能力规划、Admin 用户/角色/系统设置管理，以及有效角色权限验收 | 待用户确认 | UI-01～UI-05、角色权限和真实容器浏览器复验均已通过；验收门禁仍包括用户集成 UAT | `docs/acceptance/ITERATION_6_TECHNICAL_ACCEPTANCE.md` 已归档 Codex 技术验收；6A-4、6B-5 用户 UAT 待执行。 |
| 7 | 种子数据、端到端回归、容器重启、日志与文档硬化 | 待用户确认 | 验收门禁：端到端场景全通过，完成最终 UAT/发布决策 | 7-1～7-3 已完成；`bash scripts/e2e-smoke.sh` 已通过；7-4 最终 UAT 与发布决策待执行。 |

---

## 3. 当前快照

- **当前状态**：当前无 Codex 实施任务处于执行中。迭代 4～7 的父级卡均为“待用户确认”；Git Project 仅以其记录任务状态、阶段、实施方和 UAT 门禁。
- **迭代 3 子阶段**：3A、3B 全部完成，3B-5 用户切片 UAT 已通过。
- **迭代 4 子阶段**：4-1～4-4 已完成；4-5 用户 UAT 待执行。
- **迭代 5 子阶段**：5-1～5-3 已完成；5-4 用户 UAT 待执行（检查清单见 `docs/acceptance/ITERATION_5_TECHNICAL_ACCEPTANCE.md`）。
- **迭代 6 子阶段**：6A/6B 的实施、角色权限和 UI-01～UI-05 真实容器浏览器复验已通过；6A-4、6B-5 用户集成 UAT 待执行。6C 的设计合规发现已归入 [#11](https://github.com/yinhui198456/team-capability-platform/issues/11)（年度计划与学习任务合体）和 [#12](https://github.com/yinhui198456/team-capability-platform/issues/12)（Buddy 复核中心合体），并已加入 GitHub Project，待 CC 执行。
- **迭代 7 子阶段**：7-1～7-3 已完成；7-4 最终 UAT 与发布决策待执行。
- **UAT 节奏**：迭代 3 起，每个业务纵向切片在 Codex 验收通过后进入用户 UAT；UAT 反馈只修复当前已授权切片范围，不新增业务规则。
- **迭代 3A 完成边界**：在迭代 2 匿名只读目录基础上，新增本地 HttpOnly Cookie 会话、`/login` 登录页、五个本地 UAT 演示账号（密码由部署环境变量配置）、N:M 有效角色与 Buddy 关系基础。不含 Assessment、Gap、Goal、Plan、Task、Evidence、Review、Admin 管理页、SSO、注册、密码重置。
- **可验证入口**：
  - 本地 UAT 登录页：`/login`
  - 能力模型只读页：`/capability/model`
  - 学习资源只读页：`/operations/resources`
  - 认证 API：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`
  - 只读 API：`GET /api/capability-model`、`GET /api/learning-resources`、`GET /api/learning-resources/{material_code}`
  - 健康检查：`/health`、`/ready`
  - 后端与前端测试：按 `docs/acceptance/ITERATION_3A_TECHNICAL_ACCEPTANCE.md` 中记录的命令执行
- **下一决策点**：用户依次完成 4-5、5-4、6A-4、6B-5 的 UAT；随后执行 7-4 最终 UAT 与发布决策。

---

## 4. 每次项目汇报固定格式

1. **当前迭代**：当前处于哪个迭代，状态是什么。
2. **门禁**：该迭代的进入门禁与验收门禁是否通过。
3. **证据**：可追溯的文档、commit 范围、测试或运行入口。
4. **下一步 / 需要用户决策**：下一动作及是否需要用户确认。

---

## 5. 下一个授权动作

当前无需继续实施代码。下一动作是用户依次完成 4-5、5-4、6A-4、6B-5 的 UAT，并在 7-4 给出最终 UAT 与发布决策。Codex 的真实容器浏览器复验不替代这些写入型业务验证。

---

## 6. 敏捷更新纪律

1. 一次迭代只交付一个可演示的纵向切片，不跨迭代预装后续范围。
2. 每个迭代按 CC 实施与测试 → Codex 审核 → 用户 UAT 的节奏推进。
3. UAT 反馈只修复当前已授权切片范围内的缺陷或体验问题，不新增业务规则。
4. 每次门禁结果（通过 / 阻塞 / 待确认）同步更新本文档与项目看板。
5. 每个主迭代启动时拆分为 3–6 张可验收子任务；WIP=1；只在子任务准入条件满足后开始。

---

## 7. 后续迭代子任务（Git Project 对应卡片）

下表保留任务合同、责任与初始门禁；实际完成状态以第 3 节和 Git Project 为准。每张卡片均按“CC 实施与测试 → Codex 审核 → 用户 UAT”闭环推进；`UAT` 卡由用户执行确认。对 5～7 的已完成实施，用户曾明确授权在前序 UAT 延后时继续开发；该例外只解除实施排期，不表示任何 UAT 已通过。

| 顺序 | 子任务 | 准入与门禁 | 实施方 | 输出与验收 |
|---|---|---|---|---|
| 3B-1 | Assessment 草稿、提交与历史 | 3A UAT 通过；仅本人 L3 自评 | CC | Assessment/Detail 的草稿、提交、不可变历史及 UI-02 自评区；测试通过 |
| 3B-2 | Buddy 自评复核闭环 | 3B-1 通过；仅负责成员 | CC | Assessment Review 的指导、认可/建议调整、历史闭环及 UI-04 队列；测试通过 |
| 3B-3 | Gap 生成、优先级与计划候选 | 3B-2 认可的最新提交存在 | CC | Gap 计算、分级、优先级与纳入候选标记，绑定 UI-02；测试通过 |
| 3B-4 | 年度计划生成统一门禁 | 3B-1 至 3B-3 通过 | CC | 后端强制“最新提交已认可且无待复核”门禁，前端展示原因；阻塞/解除测试通过 |
| 3B-5 | 3B 切片 UAT | 3B-4 经 Codex 审核通过 | 用户 | 自评、复核、Gap、门禁阻塞/解除的 UAT 结论；通过后迭代 3 完成 |
| 4-1 | Growth Goal 与 Gap 纳入 | 迭代 3 UAT 通过 | CC | 从合格 Gap 创建/维护 Growth Goal，绑定 UI-03；范围与权限测试通过 |
| 4-2 | 年度成长计划与 Plan Item 生成 | 4-1 通过；复用 3B 统一门禁 | CC | 年度成长计划、按 L3 自动生成 Plan Item、12 个月周期；测试通过 |
| 4-3 | Learning Task 1:1 与执行管理 | 4-2 通过 | CC | 每个 Plan Item 恰有一个 Learning Task、状态/日期/执行管理；约束测试通过 |
| 4-4 | Learning Progress Log 与时长聚合 | 4-3 通过 | CC | `task_id`、`record_date`、`actual_hours`、`note`、`recorder`；仅聚合时长、不改变 1:1；月度视图测试通过 |
| 4-5 | 迭代 4 UAT | 4-4 经 Codex 审核通过 | 用户 | Goal、计划、任务、日志与时长聚合的 UI-03 UAT 结论 |
| 5-1 | Evidence 草稿、提交与版本 | 迭代 4 UAT 通过 | CC | Evidence 对应 Learning Task/L3；草稿→待 Review；补充形成新版本；旧版只读测试通过 |
| 5-2 | Buddy Evidence Review 与反馈历史 | 5-1 通过；仅负责成员 | CC | 通过/需补充/驳回、Review 历史闭环、旧记录不回流；UI-04 测试通过 |
| 5-3 | Capability Profile 成长档案聚合 | 5-2 通过 | CC | 按 Member/年度汇总目标、任务、时长、Evidence/Review 结果；权限与聚合测试通过 |
| 5-4 | 迭代 5 UAT | 5-3 经 Codex 审核通过 | 用户 | Evidence 版本、Review 历史和成长档案的 UAT 结论 |
| 6A-1 | 我的成长看板指标与数据聚合 | 迭代 5 UAT 通过 | CC | UI-01 所需年度进度、时长、Gap、待办与任务指标；口径测试通过 |
| 6A-2 | Member 页面视觉与交互整合 | 6A-1 通过 | CC | UI-01、UI-02、UI-03 的 Member 流程与原型一致；角色范围测试通过 |
| 6A-3 | Buddy 页面视觉与交互整合 | 6A-2 通过 | CC | UI-04 自评/Evidence Review 队列、反馈与历史；负责成员范围测试通过 |
| 6A-4 | 6A UAT | 6A-3 经 Codex 审核通过 | 用户 | UI-01 至 UI-04 的 Member/Buddy 可用性与原型对照结论 |
| 6B-1 | Leader 能力模型与学习资源维护 | 6A UAT 通过 | CC | Leader 维护能力模型/资源；其他角色按范围只读；权限与回归测试通过 |
| 6B-2 | 团队年度能力规划 | 6B-1 通过 | CC | Leader 发布/归档 Team Annual Capability Plan；不与个人年度成长计划混用 |
| 6B-3 | 团队能力分析与 UI-05 | 6B-2 通过 | CC | 团队范围能力分析、筛选与 UI-05 原型绑定；指标和范围测试通过 |
| 6B-4 | Admin 用户、角色与系统配置 | 6B-3 通过 | CC | 用户/角色 N:M、系统配置管理；Admin 不因身份自动获得 Buddy Review；权限测试通过 |
| 6B-5 | 6B 集成 UAT | 6B-4 经 Codex 审核通过 | 用户 | UI-01 至 UI-05 原型对照、Leader/Admin 权限及集成 UAT 结论 |
| 7-1 | 演示种子数据与可重复初始化 | 迭代 6 UAT 通过 | CC | 覆盖核心闭环的可重复本地种子；不引入生产凭据或外部服务 |
| 7-2 | 端到端回归自动化 | 7-1 通过 | CC | 匿名目录、认证、Assessment 到 Profile 的关键回归场景；容器内可重复执行 |
| 7-3 | 容器重启、日志与交付文档硬化 | 7-2 通过 | CC | 重启后数据/就绪检查、运行与验收文档；不引入复杂监控运维 |
| 7-4 | 最终 UAT 与发布决策 | 7-3 经 Codex 审核通过 | 用户 | 全链路 UAT 结论及是否发布的明确决定 |

卡片的默认实施方法为：CC 依据冻结基线与对应迭代计划执行 TDD、容器化测试、质量检查和小粒度提交；Codex 审核业务边界、回归证据与看板状态；用户仅在 UAT/发布决策卡给出结论。每张非 UAT 卡的状态初始为“Todo / 待开始”，除本节已记录的用户明确授权例外外，不得越过表中前置条件。
