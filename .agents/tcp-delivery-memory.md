# TCP 项目级长期记忆

> 只记录跨 Issue 稳定且已确认的 TCP 事实与协作决策。当前 Issue、SHA、CI、tmux pane、一次性授权、短期故障和原始日志不写入此处。

## 项目目标与权威来源

- TCP 是个人学习型 toy project，优先交付用户可尝试的可见核心流程，不默认引入生产级治理、发布列车或重型流程。
- 核心业务链路为 Capability Model → Assessment → Gap Analysis → Growth Plan → Learning Task → Evidence → Buddy Review → Capability Profile。
- 业务规则以 `capability-model/` 和 `docs/01_Product.md` 为先；设计、数据、UI、开发约束分别由 `docs/02_Design.md` 至 `05_Development.md` 承接。代码和 `runtime/` 不反向定义业务事实。

## 仓库与环境事实

- Ubuntu 运行主 checkout 为 `/opt/personal-agent-workspace/team-capability-platform`；Issue worktree 位于 `/opt/personal-agent-workspace/worktrees/<issue-worktree>`。
- `backend/` 使用 FastAPI/SQLAlchemy/pytest；迁移在 `backend/app/migrations/versions/` 并由 `runner.py` 顺序注册。`frontend/` 使用 React/TypeScript/Ant Design Pro；Vitest 测试与源码同置，Playwright 在 `frontend/tests/e2e/`。
- `runtime/` 仅放本地运行产物，`compose.yaml` 仅供开发。共享 UAT 数据库或卷永远不是可随意重置的 E2E fixture。

## 项目记忆与 worktree 的整合规则

- 项目记忆的权威对象是 Git 中的路径 `AGENTS.md` 和 `.agents/tcp-delivery-memory.md`，不是 `/team-capability-platform` 这个物理目录。主 checkout 与各 Issue worktree 都只是同一仓库在不同提交或分支上的快照。
- 新 Issue worktree 必须从包含已确认项目记忆的基础提交创建；不从主目录复制文件，不建立跨 checkout symlink，也不维护 worktree 专属长期记忆。
- Issue 推进中确认的跨 Issue 稳定事实，直接在当前 Issue worktree 修改本文件，由唯一 writer 随该 Issue 分支提交并经 PR 审查；合并后进入基础分支，供后续 Issue 继承。
- 现有其他 worktree 不会自动更新，这是分支隔离的正常行为。只有在 worktree 状态和当前门禁允许时，才通过正常 merge/rebase 接收新基线；禁止手工双写或反向覆盖。
- 当前 Issue 的状态、方案候选、SHA、tmux、writer、检查结果、临时授权和故障不进入本文件，继续放在 GitHub Issue/PR、Sol Goal/Plan 与可追溯证据。

## 已确认协作模型

- TCP 不存在跨 Issue 的单一 controller。每个 Issue 有自己的 Sol controller、Goal/Plan、control window/conversation 和 worktree；Sol 只拥有本 Issue，不接管或改写其他 Issue 的 Goal/Plan。
- `tcp-codex-control` 是容纳各 Issue control windows 的共享 tmux session，不是跨 Issue controller。多个 Issue Sol 可并行做只读分析、需求澄清、设计和门禁准备；依赖与优先级通过 GitHub Issues/Project 和明确 handoff 协调。
- Sol 拥有本 Issue 的 Goal/Plan、合同、门禁和验收编排；产品代码只能由当前合同指定的唯一 writer 修改。
- reviewer 是 Sol 创建的受合同限制的只读子会话；常态为一个 combined reviewer，通过 delivery/risk/visual 维度组合覆盖，不为逻辑角色常驻多个技术会话。
- agent 是否具备可写工具不等于获准写入；角色、允许对象、检查维度、禁止动作、证据要求、停止条件和返回格式必须写进当前合同。Reviewer 的结论不是 writer 自述的替代品。
- 上述并行不改变全局共享资源上限：除非用户另行授权，全 TCP 同时最多一个 code writer/commit owner 和一个 mutable test/database stack。需要切换 writer 时，先验证旧 writer 已停止写入，以及 pane、worktree、branch/HEAD、工作区状态和目标环境身份。

## 七阶段交付与反馈回退

既有历史编号保持原记录、不倒填；新 Issue 统一使用下表语义：

| 阶段 | 输入/活动 | 输出/门禁 |
|---|---|---|
| S1 需求范围与验收矩阵 | 原始反馈、需求 ID、身份/数据条件、依赖、非范围 | 冻结需求级验收矩阵 |
| S2 连续业务流与原型 | 先同步权威业务/UI 文档，再完成统一高保真原型并由用户确认 | 冻结业务与设计合同 |
| S3 实施合同与切片 | 明确最小实现、依赖、事务/并发边界、切片顺序及测试映射 | 有界 writer 合同；本阶段不写实现 |
| S4 红绿实现与自测 | 唯一 writer 同步权威文档、红绿实现并运行定向检查和差异审查 | 可交付候选，不以 writer 自述代替证据 |
| S5 独立复核与同候选检查 | 非 writer 按 delivery/risk/visual 维度复核，并检查同一精确候选 | 复核结论、检查结果和未覆盖项 |
| S6 受控技术验收 | 合同固定候选版本、环境、身份/账号、可变记录、单一 owner、允许动作/重试边界和停止条件后，准入唯一测试环境；分别执行 smoke、真实 Chrome 操作、同状态 1440/1024/768 原型对照 | 每类证据各自的结论和未覆盖项 |
| S7 用户最终验收与收尾 | 用户操作候选并分类反馈；另获明确授权后才执行收尾动作 | 分层记录业务验收、PR、分支和发布状态 |

- S1/S2 是业务与设计确认，不是后续写入、环境、push、部署或 UAT 的逐步索权；每次可变操作仍以当前有界合同为准。
- 需求、身份/数据条件、非范围或连续业务流变化回 S1/S2；普通缺陷回到最早受影响的 S3/S4，只做闭环所需的最小修改并重走下游门禁，不重开无关范围。
- 异步加载、自动保存、队列、revision 和幂等属于同一链路族：同类根因第二次出现时，除修复触发点外，还要检查整条受影响链路并增加有界族级回归，覆盖 session/年度切换、请求队列、旧响应、失败输入保留、缺字段零写入、重试幂等、业务结果唯一及结果计数和旧测试合同同步。测试 fixture 必须隔离身份、年度与清理边界，不复用共享可变记录；具体字段、账号和权限仍由当前 Issue 合同定义。

## 原型、技能、环境与监督证据

- 统一原型入口是 `docs/assets/ui-prototypes/prototype-v1/index.html`。交付前必须实际打开资源并操作关键交互；无溢出截图不等于符合批准原型。Git push 不等于 GitHub Pages 已发布，依赖相对资产的高保真页面必须保留完整目录结构，单独保存一个 HTML 不能证明原型可运行或高保真交付完成；未经授权不得合并或改 Pages 来源。
- 只有真实执行了对应专业 skill，并记录需求、页面状态/视口、发现、结论与缺口，才可声称“经过该 skill 验证”；读取 skill 名称、复述清单、截图或普通 smoke 均不能替代专业 UI/UX、真实 Chrome 与用户确认，原型自审也不替代实现候选的独立专业审查。
- 未授权 DB/环境变更时，若启动或检查会自动迁移，必须先停下并取得具体授权。红色 CI 只证明对应检查未通过，先区分产品缺陷、测试合同、数据 fixture 或环境原因；不自动扩大文件、行为、环境或修复范围，也不豁免真实回归，例外必须先由当前有界合同明确授权。
- 监督消息的 `queued`、`received`、`replied`、`completed` 必须分开报告；Goal 暂无推进、缺少状态采集字段或正常等待用户不等于业务失败，不重复刷屏。监督者只联系本 Issue Sol，不旁路指挥 writer；监控收尾依当前有界合同核对过期监控并执行已授权动作，已覆盖动作不重复索权，超范围或对象不明才补授权，Goal 完成不许可任意清理。

## 收尾、复盘与继承

- 收尾始终分开陈述四层：用户业务验收、精确候选的 CI/UAT、PR 合并及目标 base、默认分支/生产发布；任一层都不推导其他层。
- 用户验收后的 docs 尾提交要证明相对候选没有业务代码差异，并核对、记录该 docs SHA 实际执行的文档检查/CI 结果；未运行项如实记录，旧候选的 CI 不得冒充新 SHA 的执行结果，用户验收也不得倒填未运行的浏览器场景。
- 已关闭 Issue 的稳定复盘通过基于预定集成基线的独立 docs 分支/PR 进入项目记忆，不追加到旧交付 PR。合并后的新 Issue worktree 才继承该记忆；外部实践资料只帮助判断规则应放在用户级、项目级或 Issue 即时层，不自动成为 TCP 规则，也不整套复制其测试或默认分支约定。
- 本规则源于 [Issue #201](https://github.com/yinhui198456/team-capability-platform/issues/201) 与 [PR #202](https://github.com/yinhui198456/team-capability-platform/pull/202) 的复盘证据，包括 [原型对照回退](https://github.com/yinhui198456/team-capability-platform/issues/201#issuecomment-5539514727)、[异步会话隔离](https://github.com/yinhui198456/team-capability-platform/commit/6922171f15f86323055fefdbf20a235105a3250b)、[清空后恢复](https://github.com/yinhui198456/team-capability-platform/commit/3cbfd8a3067a3285617b071acee961ff6b325af5)、[旧测试合同同步](https://github.com/yinhui198456/team-capability-platform/commit/505b498bd9d1cb17bf58581ee03dacb98b6911b0)、[跨页旧加载保护](https://github.com/yinhui198456/team-capability-platform/commit/4ded879c29347016745f4bae8949d13cc8b334c4)与[最终用户验收](https://github.com/yinhui198456/team-capability-platform/issues/201#issuecomment-5586465396)；这些链接是规则来源，不是当前 Issue 状态。

## 证据与状态放置

- 用户级规则在 `~/.codex/AGENTS.md`（Codex）和 `~/.claude/CLAUDE.md`（Claude Code）；项目即时规则在根 `AGENTS.md` / `CLAUDE.md`；本文件存 TCP 的稳定记忆。
- 当前任务状态在 GitHub Issue/PR、当前 Sol Goal/Plan 与可追溯验证证据；不要把它们沉淀进长期记忆。
- 产品变更的验收分为：独立专业审查、同版本自动化/E2E、真实 Chrome 交互、用户最终 UAT。每层记录自己的范围、结论和缺口，不混称为“已验收”。

## 维护规则

- 仅在事实已验证且预计跨 Issue 有效时更新；优先改短条目，不追加会议纪要、完整日志或重复指令。
- 协作拓扑、环境路径、权威文档或验收边界变更时，同步检查本文件、根 `AGENTS.md`/`CLAUDE.md` 和相关 `.claude/rules/` 是否仍一致。
