# 02 Design

## 1. 设计目标

本文档基于 `docs/01_Product.md` 中的业务规则，描述 Team Capability Platform（TCP）的系统设计，包括信息架构、页面结构、用户流程、业务状态机、角色权限、核心对象关系以及页面与业务对象的映射。

设计约束：

- 不修改 Product 中已冻结的业务规则。
- 只描述系统如何实现业务，不涉及具体代码、API 或数据表设计。
- 所有页面与流程均围绕「能力模型 → 能力评估 → Gap 分析 → 成长目标 → 年度成长计划 → 计划项 → 学习任务 → Evidence → Buddy Review → 成长档案」闭环展开。

---

## 2. 信息架构（IA）

平台按业务域划分为五大模块：

```mermaid
flowchart TD
    TCP[TCP 团队能力运营平台]
    TCP --> CAP[Capability 能力管理]
    TCP --> GRO[Growth 成长管理]
    TCP --> MEN[Mentoring 导师指导]
    TCP --> OPE[Operations 团队运营]
    TCP --> SYS[System 系统管理]

    CAP --> CAP1[能力模型]
    CAP --> CAP2[能力评估]
    CAP --> CAP3[Gap 分析]

    GRO --> GRO1[成长目标]
    GRO --> GRO2[年度成长计划]
    GRO --> GRO2_1[计划项 L3能力项]
    GRO --> GRO3[学习任务]
    GRO --> GRO4[成长档案]

    MEN --> MEN1[Buddy 关系]
    MEN --> MEN2[Evidence Review]
    MEN --> MEN3[反馈与建议]

    OPE --> OPE1[学习资源]
    OPE --> OPE2[团队能力分析]
    OPE --> OPE3[团队年度能力规划]

    SYS --> SYS1[用户管理]
    SYS --> SYS2[角色权限]
    SYS --> SYS3[系统配置]
```

### 2.1 计划对象层级

成长管理模块内部的对象层级为：

```text
年度成长计划（个人/年度）
  └── 计划项（三级能力项 L3）
        └── 学习任务
              ├── Learning Progress Log（学习执行日志）
              └── Evidence
                    └── Evidence Review
```

- **年度成长计划（Annual Growth Plan）**：个人按年度维护的计划容器，默认周期为 12 个月，记录整体进度与统计；不简称为 Growth Plan，也不与团队年度能力规划混用。
- **计划项（Plan Item）**：从 Gap 分析中纳入计划的三级能力项，是计划与跟踪的最小单元。
- **学习任务（Learning Task）**：由计划项派生，用于记录执行过程，与计划项保持关联但独立维护执行状态。
- **学习执行日志（Learning Progress Log）**：Learning Task 下的执行记录，字段为 `task_id`、`record_date`、`actual_hours`、`note`、`recorder`，仅用于学习时长聚合，不拆分任务或改变 Plan Item → Learning Task 的 1:1 关系。
- **Evidence**：学习任务的可验证输出。
- **Evidence Review**：Buddy 对 Evidence 的复核与反馈记录。

### 2.2 模块说明

| 模块 | 职责 | 主要使用角色 |
|---|---|---|
| Capability | 维护能力标准、支撑能力评估、生成 Gap 分析 | Leader / Member / Buddy |
| Growth | 管理成长目标、年度成长计划、计划项、学习任务执行、学习执行日志、成长档案 | Member / Buddy |
| Mentoring | Buddy 对成员自评与 Evidence 进行辅导、复核和反馈 | Buddy / Member |
| Operations | 维护学习资源、团队能力分析、团队年度能力规划 | Leader |
| System | 用户、角色、权限、系统参数 | Admin |

---

## 3. 用户导航结构

平台采用顶部主导航 + 左侧子导航的布局。

### 3.1 顶部主导航

```
[能力管理] [成长管理] [导师指导] [团队运营] [系统管理] [个人中心]
```

### 3.2 各角色默认首页

| 角色 | 默认首页 | 说明 |
|---|---|---|
| Member | 我的成长看板 | 展示年度进度、待办任务、待提交 Evidence |
| Buddy | 辅导成员看板 | 展示负责成员列表、待 Review 的 Evidence |
| Leader | 团队运营看板 | 展示团队能力分析、团队年度能力规划 |
| Admin | 系统管理首页 | 展示用户、角色、系统配置入口 |

### 3.3 左侧子导航示例

**能力管理模块下：**

```
- 能力模型
- 能力自评
- Gap 分析
- 评估历史
```

**成长管理模块下：**

```
- 成长目标
- 年度成长计划
- 学习任务
- 成长档案
```

**导师指导模块下：**

```
- 我的辅导成员
- Evidence Review
- 反馈记录
```

**团队运营模块下：**

```
- 学习资源
- 团队能力分析
- 团队年度能力规划
```

**系统管理模块下：**

```
- 用户管理
- 角色权限
- 系统配置
```

---

## 4. 页面清单

| 页面名称 | 路由路径 | 主要角色 | 所属模块 | 页面目的 | 关联业务对象 |
|---|---|---|---|---|---|
| 我的成长看板 | /dashboard/member | Member | Growth | 查看年度进度、待办、完成情况 | Annual Growth Plan / Plan Item / Learning Task / Learning Progress Log / Evidence |
| 能力模型 | /capability/model | 全员 | Capability | 查看一级 / 二级 / 三级能力项及等级描述 | Capability Model |
| 能力标准版本 | /capability/standards | 全员 | Capability | 查看能力标准版本与内容 | Capability Model |
| 能力自评 | /capability/assessment | Member | Capability | 填写当前掌握度与依据，查看标准目标，按需申请个人调整 | Assessment |
| Gap 分析（已并入能力自评页，/capability/gap 重定向） | /capability/assessment | Member / Buddy | Capability | 查看 Gap 值、分级、优先级，选择纳入计划项 | Gap |
| 评估历史 | /capability/assessment/history | Member / Buddy | Capability | 查看历次评估快照与成长曲线 | Assessment |
| 成长目标（已并入年度计划页，/growth/goals 重定向） | /growth/annual-plan | Member | Growth | 确认年度补齐目标 | Growth Goal / Gap |
| 年度成长计划 | /growth/annual-plan | Member | Growth | 查看和编辑年度成长计划及其计划项 | Annual Growth Plan / Plan Item |
| 学习任务（已并入年度计划页，/growth/tasks 重定向） | /growth/annual-plan | Member | Growth | 跟踪学习任务执行状态、填写学习执行日志、提交 Evidence | Learning Task / Learning Progress Log / Evidence / Plan Item |
| 月度复盘 | /growth/review/monthly | Member / Buddy / Leader | Growth | 查看月度计划完成情况 | Plan Item / Learning Task |
| 成长档案 | /growth/profile | Member | Growth | 查看个人完整成长记录 | Capability Profile |
| 辅导成员看板 | /mentoring/dashboard | Buddy | Mentoring | 查看负责成员进度与待办 | Member / Learning Task / Evidence |
| 自评复核（已并入辅导成员看板，/mentoring/assessment-review 重定向） | /mentoring/dashboard | Buddy | Mentoring | 历史自评复核仅只读追溯；新流程不再创建 Assessment Review | Assessment / Assessment Review |
| Evidence Review | /mentoring/evidence-review | Buddy | Mentoring | 复核 Evidence 并填写反馈 | Evidence / Evidence Review |
| 反馈记录（规划中，暂无路由） | /mentoring/feedback | Buddy / Member | Mentoring | 查看历史复核反馈 | Assessment Review / Evidence Review |
| 学习资源 | /operations/resources | Leader | Operations | 维护学习材料索引 | Learning Resource |
| 团队能力分析 | /operations/analytics | Leader | Operations | 查看团队 Gap 分布、完成率等指标 | Assessment / Plan Item / Evidence |
| 团队年度能力规划 | /operations/team-annual-plan | Leader | Operations | 发布团队年度能力运营重点 | Team Annual Capability Plan |
| 用户管理 | /system/users | Admin | System | 创建、编辑、启用 / 禁用用户 | User |
| 角色权限（规划中，暂无路由） | /system/roles | Admin | System | 分配角色与数据权限 | Role / Permission |
| 系统配置（规划中，暂无路由） | /system/settings | Admin | System | 维护系统参数 | System Config |
| 个人中心（规划中，暂无路由） | /profile | 全员 | System | 查看和修改个人信息 | User |

---

## 5. 用户流程（User Flow）

### 5.1 Member 主线流程

```mermaid
flowchart LR
    A[查看能力模型] --> B[开始年度自评]
    B --> C[填写当前掌握度并查看标准目标]
    C --> C1{是否申请个人调整}
    C1 -->|是| C2[填写调整值与原因]
    C1 -->|否| D[在纳入年度计划=是持久化计划草稿选择]
    C2 --> D
    D --> E[生成学习任务]
    E --> F[继续填写并增量纳入其他能力项]
    F --> G[按月度执行学习任务]
    G --> H[提交 Evidence]
    H --> I[等待 Buddy Review]
    I --> J{Review 结论}
    J -->|通过| K[学习任务完成，计划项达成，进入成长档案]
    J -->|需补充| L[补充后提交新版本 Evidence]
    L --> H
    K --> M[查看成长档案]
```

说明：

- Member 将已填写的适用 L3（current_level 0～5，含 0）的「纳入年度计划」设为「是」（决策随草稿持久化）后，系统在同一事务内原子生成：Gap 分析、年度成长计划（复用正式/可用年度计划）、计划项和学习任务；未纳入的能力项不阻塞，可后续增量纳入。
- 重复选择同一能力项幂等，不重复创建；自评不再创建 Assessment Review，也不进入 Buddy 自评复核。

### 5.2 Buddy 辅导流程

```mermaid
flowchart LR
    A[查看辅导成员列表] --> B{存在待 Review Evidence}
    B -->|是| C[Review Evidence]
    C --> D{Review 结论}
    D -->|通过| E[学习任务可标记完成]
    D -->|需补充| F[要求 Member 补充]
    F --> G[Member 创建并提交新版本 Evidence]
    G --> B
    B -->|否| H[跟踪成员成长进度]
```

### 5.3 Leader 运营流程

```mermaid
flowchart LR
    A[维护能力模型] --> B[维护学习资源]
    B --> C[发布团队年度能力规划]
    C --> D[跟踪团队自评进度]
    D --> E[查看团队 Gap 分布]
    E --> F[查看计划完成率]
    F --> G[查看 Evidence 认可率]
    G --> H[年末团队能力分析]
    H --> I[制定下一年度规划]
```

Leader 维护 L3 标准目标时，页面按 P4～P8 分别提供「使用默认 / 指定 1～5 / 不适用」。系统先解析 `recommended_start_level`；低于最早适用职级的输入禁用，API 同时拒绝越界覆盖。调整适用范围必须先修改建议起始职级。

### 5.4 Admin 管理流程

```mermaid
flowchart LR
    A[创建用户账号] --> B[分配角色]
    B --> C[配置 Buddy 关系]
    C --> D[维护系统参数]
```

---

## 6. 核心业务状态机

### 6.1 Assessment 状态机

Assessment 指一次完整的能力评估记录，按年度或晋升 / 转岗触发。历史提交流程下，每次提交自评会生成一条 Assessment Review 待复核记录，Buddy 给出结论后闭环；#178 起新流程（按所选能力项生成学习任务）不再创建 Assessment Review，历史 Review 记录保持只读兼容、仅供追溯。

Assessment 创建时，系统按以下顺序为全部启用 L3 生成一次标准目标快照：

1. 解析 `recommended_start_level` 并判断 Member 目标职级是否已进入适用范围；未进入时标记「不适用」。
2. 已适用时读取对应职级 Leader 覆盖；数值覆盖取 1～5，空值覆盖表示明确「不适用」。
3. 无覆盖时按 P4=2、P5=3、P6=4、P7=5、P8=5 生成标准目标。

该快照创建后不再随能力模型、覆盖值或 Member 目标职级变化。Member 只能提交当前掌握度、自评依据、计划候选和个人调整；服务端从快照重新计算最终有效目标与 Gap。标准目标为「不适用」时禁止个人调整改变适用范围。

Member 按所选能力项生成学习任务时，系统在单一事务中原子执行：校验所选 L3 → 生成 Gap 分析 → 复用/创建年度成长计划（若不存在）→ 为所选 Gap 生成计划项 → 为每个计划项生成对应学习任务（1:1）。批次中任一 L3 校验不合格则整批零写入；重复生成幂等。

```mermaid
stateDiagram-v2
    [*] --> 草稿
    草稿 --> 待复核 : 历史提交流程（submit_assessment，UI 已不再使用）
    待复核 --> 已复核 : Buddy 复核认可（历史）
    待复核 --> 建议调整 : Buddy 建议调整（历史）
    建议调整 --> 草稿 : Member 修改后重新提交（历史）
    已复核 --> 已归档 : 完成该评估版本归档
    已归档 --> [*]
```

年中更新规则：

- Member 在执行过程中更新当前掌握度时，不修改已归档的 Assessment。
- 系统基于当前年度 Assessment 生成一个新版本 Assessment。
- 新版本 Assessment 重新进入「草稿」状态，学习任务在草稿上按所选能力项增量生成；历史版本保持已归档，纳入评估历史。
- 旧版本 Assessment 保持已归档状态，纳入评估历史。

状态说明：

| 状态 | 说明 |
|---|---|
| 草稿 | Member 正在填写自评；学习任务在草稿上按所选能力项增量生成（#178 主流程） |
| 待复核 | 历史提交流程：Member 已提交，等待 Buddy 复核给出反馈（UI 已不再使用） |
| 已复核 | 历史提交流程：Buddy 复核认可，该版本评估闭环归档 |
| 建议调整 | 历史提交流程：Buddy 认为自评不合理，Member 可选择修改后重新提交 |
| 已归档 | 该次评估已闭环，进入历史记录 |

Gap 生成与计划创建时点：

- Member 在能力自评/Gap 页面把「纳入年度计划」设为「是」（计划草稿选择随草稿持久化，是唯一的选择来源，页面无临时勾选列）并触发「生成学习任务」时，系统立即执行原子事务：校验纳入计划的 L3（含逐项校验计划月份，任一纳入项缺失则整批拒绝，无默认季度/月份；季度为派生的内部数据）→ 生成 Gap（基于当前掌握度与最终有效目标）→ 复用/创建年度成长计划 → 为纳入的 Gap 生成计划项 → 为每个计划项生成学习任务（1:1）。
- 纳入计划的 L3 若 current_level=null（未填写）、缺计划月份或缺少计划依据快照（v0009 捕获）都会阻断整批生成；未纳入的能力项不阻塞，可后续增量纳入。缺少快照返回 422 `selection_validation_failed`，逐 L3 给出 `planning_snapshot_missing` 及处置提示，绝不误报「已存在」。
- 标准目标为「不适用」的 L3 不参与 Gap、不生成 Gap 记录、不能成为计划候选，也不允许个人调整改变适用范围。
- 批次原子性：任一纳入 L3 校验不合格时整批零写入（assessment、history、plan、tasks 均不变）。
- 计划月份控件：页面上只有一个可见的 YYYY-MM 输入，点击控件任意位置即打开月份选择器（`showPicker`，不可用时以聚焦控件作为安全回退）；计划季度由月份派生，不提供季度输入。
- 乐观并发：生成请求必须携带 `expected_revision`；服务端锁定 Assessment 行后比对，过期（已被其他保存/生成推进）返回 409，零写入。有新增的计划项时，同一事务内恰好推进一次 Assessment `revision`（仅当本批存在写入）；纯已存在批保持 `revision` 不变，重放不再推进。成功响应携带最新 `revision` 与逐 L3 的 `items[]`（created / existing），前端据此如实刷新。
- 幂等性：同一 Member / 年度 / L3 重复生成时，已存在的计划项不再重复创建（0 新增）。请求可携带 `Idempotency-Key`：同 key 同请求（assessment + l3_codes + expected_revision 指纹）重放返回首次响应（`idempotent_replayed=true`）且不重复写入，也不再次推进 revision；同 key 不同请求返回 409。并发同 key 请求由 Assessment 行锁串行化，恰好写入一份。前端对每次可见生成尝试生成一个 key：相同 codes/revision 的网络失败重试复用该 key（幂等重放），选择变更或收到确定响应（成功或任意 HTTP 错误）后轮换。
- 同一 Member 同一年度始终复用一份年度成长计划；计划保留首次创建它的来源评估，后续生成新增的计划项分别保留各自准确的来源评估与明细。不得覆盖已经开始、完成或已有执行记录的计划项和任务。
- 新流程不创建 Assessment Review；历史 Review 记录保持只读兼容，仅供追溯。

Assessment Review 是 Buddy 对一次 Assessment 的复核记录（历史提交流程产物；#178 起新流程不再创建，记录保持只读兼容）。

| 属性 | 说明 |
|---|---|
| 关联对象 | 一个 Assessment 对应多条 Assessment Review（历史流程每次提交生成一条） |
| 复核结论 | 认可 / 建议调整 |
| 复核反馈 | Buddy 的具体意见与建议 |
| 复核人 | 负责该 Member 的 Buddy |
| 复核时间 | Review 完成时间 |
| 状态 | 待复核 / 已闭环 |
| 版本规则 | Member 调整后重新提交时创建新的 Assessment Review；历史 Review 记录保留并闭环 |

### 6.2 计划项状态机

计划项（Plan Item）是年度成长计划中的最小跟踪单元，对应一个纳入计划的三级能力项。

```mermaid
stateDiagram-v2
    [*] --> 未开始
    未开始 --> 进行中 : Member 开始执行
    进行中 --> 已完成 : 对应学习任务已完成，且有通过的 Evidence
    进行中 --> 延期 : 超过计划截止日期未完成
    进行中 --> 暂停 : Member 主动暂停
    暂停 --> 进行中 : Member 恢复执行
    未开始 --> 取消 : Member 取消计划项
    进行中 --> 取消 : Member 取消计划项
    已完成 --> [*]
    延期 --> 进行中 : Member 继续执行
    延期 --> 取消 : Member 取消计划项
    取消 --> [*]
```

状态说明：

| 状态 | 说明 |
|---|---|
| 未开始 | 计划项已生成，尚未开始执行 |
| 进行中 | 已开始执行，尚未达到完成判定条件 |
| 已完成 | 学习任务已完成，且 Evidence 获 Buddy 认可 |
| 延期 | 超过计划截止日期未完成 |
| 暂停 | 临时中止，后续可恢复 |
| 取消 | 不再执行，需记录原因 |

### 6.3 年度成长计划状态机

年度成长计划（Annual Growth Plan）是个人年度的计划容器，状态反映整体计划周期。

```mermaid
stateDiagram-v2
    [*] --> 制定中
    制定中 --> 执行中 : 显式生成学习任务时原子创建，立即进入执行
    执行中 --> 已归档 : 年度周期结束或 Member 手动归档
    已归档 --> [*]
```

### 6.4 Learning Task 状态机

Learning Task 由计划项派生，用于记录该 L3 计划项的执行与 Evidence 提交过程。它不是另一份计划项：一个计划项派生一个学习任务；计划项反映该 L3 的年度计划达成，学习任务反映执行与 Evidence Review 进度。

```mermaid
stateDiagram-v2
    [*] --> 未开始
    未开始 --> 进行中 : Member 开始任务
    进行中 --> 已完成 : 完成判定条件满足
    进行中 --> 延期 : 超过截止日期
    进行中 --> 暂停 : Member 暂停
    暂停 --> 进行中 : Member 恢复
    暂停 --> 取消 : Member 取消
    未开始 --> 取消 : Member 取消
    进行中 --> 取消 : Member 取消
    已完成 --> [*]
    延期 --> 进行中 : Member 恢复执行
    延期 --> 暂停 : Member 暂停
    延期 --> 已完成 : 完成判定条件满足
    延期 --> 取消 : Member 取消
    取消 --> [*]
```

说明：

- 学习任务固定为六种状态：未开始、进行中、暂停、延期、已完成、取消；其中「已完成」「取消」为终态，不再接受任何迁移。
- 「待 Evidence Review」不是学习任务状态。Member 提交 Evidence 后任务保持「进行中」，Review 状态记录在 Evidence 上；任务完成由 Evidence「通过」驱动。
- 完成判定条件（completion gate，服务端强制，不满足返回 422 `completion_gate_failed`）：存在结论为「通过」的 Evidence；`review_conclusion` 非空；有效日志聚合 `actual_hours` 大于 0；`completion_quality` 为达到预期 / 部分达到 / 超出预期之一；`next_action` 非空且不超过 200 字。
- 迁移通过 `POST /api/planning/learning-tasks/{task_id}/transitions` 执行：延期须带 `delay_reason`（可选 `revised_due_date`），暂停须带 `pause_reason`，取消须带 `cancel_reason`；非法迁移返回结构化 422 `invalid_task_transition`。
- 每次迁移将任务状态同步映射回来源计划项。

### 6.4.1 并发与幂等语义

以下语义对 Learning Task 迁移、计划项与 Evidence 更新、进度日志一致适用：

- **乐观并发（CAS）**：计划项、学习任务与 Evidence 均维护单调递增 `revision`；写请求须携带 `expected_revision`，过期返回 409（`plan_revision_conflict` / `task_revision_conflict` / `evidence_revision_conflict`）。客户端保留输入、刷新最新 revision 后由用户确认重试。
- **幂等写入**：进度日志、任务迁移、Evidence Review 与按所选 L3 生成学习任务（#178）接受 `idempotency_key`；同 key 同 payload 重放返回首次响应，不重复写入；同 key 不同 payload 返回 409（`log_idempotency_conflict` / `transition_idempotency_conflict` / `review_idempotency_conflict`；#178 生成路径复用 `assessment_idempotency_key` 表并返回 `idempotent_replayed`）。

### 6.5 Evidence 状态机

Evidence 是学习任务的可验证输出，必须对应一个 L3 能力项。Member 可在提交前保存草稿；每次提交形成一个 Evidence 版本。补充或重新提交必须创建新版本 Evidence，而不是改写或重新流转旧版本。

```mermaid
stateDiagram-v2
    [*] --> 草稿
    草稿 --> 待 Review : Member 提交 Evidence
    待 Review --> 通过 : Evidence Review 认可
    待 Review --> 需补充 : Buddy 要求补充
```

状态说明：

| 状态 | 说明 |
|---|---|
| 草稿 | Member 正在准备 Evidence，尚未提交 |
| 待 Review | Member 已提交，等待 Evidence Review |
| 通过 | Buddy 认可该 Evidence 充分证明能力达成；终态，不可再创建新版本 |
| 需补充 | Buddy 认为 Evidence 不足，Member 需补充材料后提交新版本 |

枚举中保留「驳回」「已归档」两个值，但当前没有代码路径会产生它们：Review 结论只有「通过 / 需补充」，被取代的旧版本保持「需补充」作为历史。后续如需启用，应先补设计再实现。

版本规则：

- 「需补充」的旧 Evidence 版本不得直接回到「待 Review」；「通过」版本为终态，不允许被取代。
- Member 补充时，从同一学习任务创建新的「草稿」版本并声明取代（`supersedes_evidence_id`）某个「需补充」版本；该新版本提交后进入「待 Review」，并创建新的 Evidence Review 记录，旧版本与旧 Review 作为历史保留、不回流。

### 6.6 Evidence Review 状态机

Evidence Review 是 Buddy 对一个已提交 Evidence 版本作出的历史反馈记录。每个已提交 Evidence 版本对应且仅对应一条 Evidence Review（服务端唯一约束；对同一 Evidence 重复提交返回 409 `review_already_submitted`）。Review 创建即闭环，不因后续 Evidence 版本而重新流转。

结论固定为两种：

| 结论 | 说明 |
|---|---|
| 通过 | Buddy 认可其有效或充分；Evidence 状态同步为「通过」 |
| 需补充 | Buddy 要求补充材料或说明；必须填写反馈，Evidence 状态同步为「需补充」 |

说明：

- Buddy 的「通过 / 需补充」是指导、Evidence Review 与反馈结论，不承担行政决策职责；「驳回」不是合法的 Review 结论。
- 当结论为「需补充」时，Member 提交新版本 Evidence 会触发一条新的 Review 记录；原 Review 保持闭环历史，不得再次流转。
- Review 提交接受 `idempotency_key`：同 key 同 payload 重放返回首次响应，不同 payload 返回 409 `review_idempotency_conflict`。
- Review 提交端点为 `POST /api/planning/evidences/{evidence_id}/review`，仅当前有效 Buddy 关系的 Buddy 可提交；历史查询端点为 `GET /api/planning/learning-tasks/{task_id}/evidence-reviews`。

---

## 7. 角色权限设计（RBAC）

### 7.1 角色定义

平台固定四类角色，权限可叠加。

| 角色 | 职责定位 |
|---|---|
| Member | 执行自评、制定计划、完成任务、提交 Evidence |
| Buddy | 辅导成员、Review Evidence（成果验收）、跟踪进度 |
| Leader | 维护能力模型与学习资源、团队分析、团队年度能力规划 |
| Admin | 用户、角色、权限、系统配置管理 |

### 7.2 权限列表

| 权限编码 | 权限名称 | 说明 |
|---|---|---|
| capability.model.view | 查看能力模型 | 查看能力域、能力项、等级描述 |
| capability.model.manage | 维护能力模型 | 编辑能力域、能力项、等级描述、导入导出 |
| assessment.self | 完成自评 | Member 填写自评并按所选能力项生成学习任务 |
| assessment.view.own | 查看自己的评估 | Member 查看个人评估历史 |
| assessment.view.assigned | 查看负责成员的评估 | Buddy 查看辅导成员评估 |
| assessment.view.team | 查看团队评估 | Leader 查看团队整体评估 |
| assessment.review | 复核自评（历史） | Buddy 复核自评结果；新流程不再创建自评复核 |
| gap.view.own | 查看自己的 Gap | Member 查看个人 Gap 分析 |
| gap.view.assigned | 查看负责成员的 Gap | Buddy 查看辅导成员 Gap |
| gap.view.team | 查看团队 Gap | Leader 查看团队 Gap 分布 |
| plan.manage.own | 管理自己的年度成长计划 | Member 制定和调整年度计划 |
| plan.view.assigned | 查看负责成员的计划 | Buddy 查看辅导成员计划 |
| plan.view.team | 查看团队计划 | Leader 查看团队计划完成情况 |
| task.manage.own | 管理自己的学习任务 | Member 执行任务、更新状态 |
| task.view.assigned | 查看负责成员的任务 | Buddy 查看辅导成员任务 |
| evidence.submit.own | 提交自己的 Evidence | Member 提交 Evidence |
| evidence.view.assigned | 查看负责成员的 Evidence | Evidence Review 使用 |
| evidence.review | Review Evidence | Buddy 给出 Review 结论 |
| evidence.view.team | 查看团队 Evidence | Leader 查看团队 Evidence |
| profile.view.own | 查看自己的成长档案 | Member 查看个人档案 |
| profile.view.assigned | 查看负责成员的档案 | Buddy 查看辅导成员档案 |
| profile.view.team | 查看团队成长档案 | Leader 查看团队档案 |
| resource.manage | 维护学习资源 | Leader 维护学习材料索引 |
| analytics.view.team | 查看团队分析 | Leader 查看团队能力分析 |
| teamannualplan.manage | 管理团队年度能力规划 | Leader 发布团队年度规划 |
| user.manage | 管理用户 | Admin 创建、编辑用户 |
| role.manage | 管理角色权限 | Admin 分配角色 |
| system.config | 系统配置 | Admin 维护系统参数 |

### 7.3 角色权限矩阵

| 权限 | Member | Buddy | Leader | Admin |
|---|---|---|---|---|
| 查看能力模型 | ✓ | ✓ | ✓ | ✓ |
| 维护能力模型 | - | - | ✓ | - |
| 完成自评 | ✓ | - | - | - |
| 查看自己的评估 | ✓ | ✓ | ✓ | ✓ |
| 查看负责成员的评估 | - | ✓ | - | ✓ |
| 查看团队评估 | - | - | ✓ | ✓ |
| 复核自评 | - | ✓ | - | - |
| 查看自己的 Gap | ✓ | ✓ | ✓ | ✓ |
| 查看负责成员的 Gap | - | ✓ | - | ✓ |
| 查看团队 Gap | - | - | ✓ | ✓ |
| 管理自己的年度成长计划 | ✓ | - | - | - |
| 查看负责成员的计划 | - | ✓ | - | ✓ |
| 查看团队计划 | - | - | ✓ | ✓ |
| 管理自己的学习任务 | ✓ | - | - | - |
| 查看负责成员的任务 | - | ✓ | - | ✓ |
| 提交自己的 Evidence | ✓ | - | - | - |
| 查看负责成员的 Evidence | - | ✓ | - | ✓ |
| Review Evidence | - | ✓ | - | - |
| 查看团队 Evidence | - | - | ✓ | ✓ |
| 查看自己的成长档案 | ✓ | ✓ | ✓ | ✓ |
| 查看负责成员的档案 | - | ✓ | - | ✓ |
| 查看团队成长档案 | - | - | ✓ | ✓ |
| 维护学习资源 | - | - | ✓ | - |
| 查看团队分析 | - | - | ✓ | ✓ |
| 管理团队年度能力规划 | - | - | ✓ | - |
| 管理用户 | - | - | - | ✓ |
| 管理角色权限 | - | - | - | ✓ |
| 系统配置 | - | - | - | ✓ |

### 7.4 数据可见性

数据可见性按用户当前拥有的有效角色叠加生效；一个 User 与 Role 为 N:M 关系，角色权限取并集，不相互排斥：

| 数据范围 | 说明 | 生效角色 |
|---|---|---|
| 本人数据 | 用户自己的评估、Gap、年度成长计划、计划项、学习任务、学习执行日志、Evidence、成长档案 | Member（自己） |
| Buddy 负责成员数据 | Buddy 所负责成员的相关数据 | Buddy（负责成员） |
| Leader 团队数据 | 团队内所有成员的相关数据 | Leader（整个团队） |
| 全量数据 | 平台全部数据 | Admin |

说明：

- 多角色用户按有效角色权限叠加。例如 Leader 同时是 Member 时，可查看本人数据与团队数据；Buddy 同时是 Member 时，也保留本人数据访问范围。
- Buddy 只能查看自己被明确分配负责的成员数据，不能查看其他成员数据。
- Leader 可查看整个团队数据，但当前产品规则未开放 Leader 直接修改 Member 自评、计划或 Evidence。
- Admin 默认拥有全量数据查看权限与系统管理权限；自评、复核、Review、计划维护等业务操作权限需通过 Member / Buddy / Leader 角色叠加获得。

---

## 8. 核心对象关系说明

平台核心对象及其关系如下：

```mermaid
flowchart TD
    User[User 用户]
    Role[Role 角色]
    BuddyRel[Buddy Relationship Buddy 关系]
    CapModel[Capability Model 能力模型]
    CapDomain[Capability Domain 能力域]
    CapItem2[Capability Item L2 二级能力项]
    CapItem3[Capability Item L3 三级能力项]
    Assessment[Assessment 能力评估]
    AssessmentReview[Assessment Review 自评复核记录]
    Gap[Gap 能力差距]
    GrowthGoal[Growth Goal 成长目标]
    AnnualPlan[Annual Growth Plan 年度成长计划]
    PlanItem[Plan Item 计划项]
    Task[Learning Task 学习任务]
    ProgressLog[Learning Progress Log 学习执行日志]
    Evidence[Evidence 能力证明]
    EvidenceReview[Evidence Review 能力证明复核记录]
    Resource[Learning Resource 学习资源]
    TeamAnnualPlan[Team Annual Capability Plan 团队年度能力规划]
    Profile[Capability Profile 成长档案]

    User -->|拥有 N:M| Role
    User -->|作为 Member 被分配| BuddyRel
    User -->|作为 Buddy 负责| BuddyRel
    CapModel -->|包含多个| CapDomain
    CapDomain -->|包含多个| CapItem2
    CapItem2 -->|包含多个| CapItem3
    CapItem3 -->|关联| Resource
    User -->|每年产生| Assessment
    Assessment -->|针对每个三级能力项| CapItem3
    Assessment -->|生成| Gap
    Assessment -->|每次提交创建一条| AssessmentReview
    AssessmentReview -->|由 Buddy 执行| User
    Gap -->|被纳入后形成| GrowthGoal
    GrowthGoal -->|进入| AnnualPlan
    AnnualPlan -->|包含多个| PlanItem
    PlanItem -->|对应一个| Gap
    PlanItem -->|派生| Task
    Task -->|对应| CapItem3
    Task -->|记录执行时长| ProgressLog
    Task -->|可提交多个版本| Evidence
    Evidence -->|提交后创建一条| EvidenceReview
    EvidenceReview -->|由 Buddy 执行| User
    TeamAnnualPlan -->|由 Leader 发布| User
    Profile -->|汇总| Assessment
    Profile -->|汇总| AssessmentReview
    Profile -->|汇总| AnnualPlan
    Profile -->|汇总| PlanItem
    Profile -->|汇总| Task
    Profile -->|汇总| Evidence
    Profile -->|汇总| EvidenceReview
```

### 8.1 对象关系说明

| 关系 | 基数 | 说明 |
|---|---|---|
| User : Role | N:M | 一个用户可拥有多个角色，权限叠加 |
| User : Buddy Relationship | 1:N | MVP 中每个 Member 仅有 1 名主 Buddy；一个 Buddy 可负责多个 Member |
| Capability Model : Capability Domain | 1:N | 一个能力模型包含多个一级能力域 |
| Capability Domain : Capability Item L2 | 1:N | 一个能力域包含多个二级能力项 |
| Capability Item L2 : Capability Item L3 | 1:N | 一个二级能力项包含多个三级能力项 |
| Capability Item L3 : Learning Resource | N:M | 一个三级能力项可关联多个学习材料；一个材料可服务于多个能力项 |
| User : Assessment | 1:N | 一个用户每年可产生一次或多次评估 |
| Assessment : Capability Item L3 | N:M | 一次评估针对多个三级能力项打分 |
| Assessment : Assessment Review | 1:N | 一次 Assessment 可包含多条 Assessment Review；每次提交生成一条，历史记录保留 |
| Assessment : Gap | 1:N | 一次评估生成多个 Gap 项 |
| Gap : Growth Goal | 1:1 | 一个被纳入计划的 Gap 项形成一个成长目标 |
| Growth Goal : Annual Growth Plan | N:1 | 多个成长目标归属于一份年度成长计划 |
| Annual Growth Plan : Plan Item | 1:N | 一份年度成长计划包含多个计划项 |
| Plan Item : Learning Task | 1:1 | 一个计划项派生一个学习任务 |
| Learning Task : Learning Progress Log | 1:N | 一个学习任务可有多条学习执行日志；日志仅用于按日期聚合实际时长，不拆分任务 |
| Learning Task : Evidence | 1:N | 一个学习任务可产生多个 Evidence 版本 |
| Evidence : Evidence Review | 1:1 | 每个已提交 Evidence 版本创建一条 Evidence Review 记录；补充或重新提交创建新的 Evidence 版本与新的 Review 记录 |
| Team Annual Capability Plan : User | 1:N | 一份团队年度能力规划面向团队内多个用户 |
| Capability Profile : User | 1:1 每年 | 每个用户每年生成一份成长档案 |

---

## 9. 页面与业务对象映射

| 页面 | 主要业务对象 | 支持操作 |
|---|---|---|
| 我的成长看板 | Annual Growth Plan / Plan Item / Learning Task / Learning Progress Log / Evidence | 查看进度、待办提醒与学习时长 |
| 能力模型 | Capability Model / Capability Domain / Capability Item | 查看、按域筛选、展开能力项 |
| 能力自评 | Assessment / Capability Item L3 | 填写当前掌握度与依据、查看标准目标、申请个人调整、提交 |
| Gap 分析 | Gap / Capability Item L3 | 查看 Gap、设置优先级、选择纳入计划 |
| 评估历史 | Assessment | 查看快照、成长曲线 |
| 成长目标 | Growth Goal / Gap | 确认年度补齐目标 |
| 年度成长计划 | Annual Growth Plan / Plan Item | 查看、编辑年度成长计划及其计划项 |
| 学习任务 | Learning Task / Learning Progress Log / Evidence / Plan Item | 更新状态、填写学习执行日志、提交 Evidence |
| 月度复盘 | Plan Item / Learning Task | 查看月度统计、填写复盘 |
| 成长档案 | Capability Profile / Assessment / Annual Growth Plan / Plan Item / Learning Task / Evidence | 查看年度成长记录 |
| 辅导成员看板 | Member / Learning Task / Evidence | 查看负责成员进度与待办 |
| 自评复核（历史） | Assessment / Assessment Review | 复核自评、给出反馈；新流程不再创建 |
| Evidence Review | Evidence / Evidence Review | 复核 Evidence、填写反馈 |
| 反馈记录 | Assessment Review / Evidence Review | 查看历史复核反馈 |
| 学习资源 | Learning Resource / Capability Item L3 | 新增、编辑、关联能力项 |
| 团队能力分析 | Assessment / Gap / Plan Item / Evidence | 查看团队指标、Gap 分布 |
| 团队年度能力规划 | Team Annual Capability Plan / Capability Domain | 发布年度重点、查看执行情况 |
| 用户管理 | User / Role | 创建、编辑、启用 / 禁用用户 |
| 角色权限 | Role / Permission | 分配角色、配置权限 |
| 系统配置 | System Config | 维护系统参数 |
| 个人中心 | User | 查看和修改个人信息 |

---

## 10. 设计约束与说明

1. **Product 为唯一业务来源**：所有页面、流程、状态机均来源于 `docs/01_Product.md`，Design 不做业务规则修改。
2. **MVP 边界**：页面与流程优先覆盖单团队、技术架构与开发专业线、四类角色的核心闭环。
3. **无代码 / 无 API / 无数据模型**：本阶段不描述具体实现、接口或数据库表结构。
4. **计划对象层级**：年度成长计划、计划项、学习任务、Evidence 为四层独立对象，状态各自维护，避免将计划项与学习任务完全等同。
5. **Buddy 定位**：Buddy 负责指导、Evidence Review（成果验收）、反馈与跟踪，不承担行政决策职责；不再承担新的自评审核/批准，历史自评复核记录仅只读追溯；Evidence Review 结论用于反馈与跟踪，不影响成员继续学习。
6. **状态机闭环**：Review 记录按次闭环；Evidence 结论为「需补充」后由 Member 创建新版本，原版本记录保留。
7. **MVP 能力域收敛**：MVP 仅启用 P01、P02、P03、C01、C02、C03 六个能力域；架构与工程、咨询与方案、DevOps 与稳定性三个域仅保留扩展占位，不导入有效 L3，不参与自评、Gap、计划、学习任务、Evidence、团队分析，也不在页面中作为可操作能力域展示。
## Issue #50 页面与流程补充

### Assessment 续评

新 Assessment 跨年度、跨评估类型沿用同一 Member 最近一次已闭环且「认可」的 Assessment。来源按最新 Review 实际闭环时间倒序、Assessment ID 倒序选择，排除草稿、待复核、建议调整、未闭环和非认可记录。新记录重新生成标准目标快照，只复制仍存在且适用的 L3 当前掌握度和有效自评依据；目标调整、最终目标、Gap、优先级和计划候选不沿用，历史记录保持不变。

### 自评与保存

Assessment Detail 记录继承来源、继承基准等级和继承基准依据。基准未改变时显示「沿用上次评估」，等级或依据改变时显示「本次已更新」。1–2 级依据可为空，3–5 级正式提交必须有依据；相对认可基准的任何等级提升（含 1→2）必须更新依据。草稿允许部分完成，正式提交执行全量校验。

草稿保存是稀疏更新：未出现在本次操作中的能力项保持原值；显式清空与字段未提交不同。Assessment 使用单调 revision 保护并发修改，过期写入必须冲突并重新加载，不得用陈旧数据覆盖新数据。

### 页面信息层级

能力自评页面正常状态一次只显示一个 L1，显示各域完成数/总数；L1 内按 L2 折叠，默认展开当前操作或定位的 L2。全局搜索结果选择后自动切换 L1、展开 L2、滚动并聚焦 L3；定位未完成和提交失败复用该路径。Gap 详情默认收进关闭的 Drawer，不保留固定右栏。主表是页面主体，底部吸附操作栏不得遮挡最后一项。
