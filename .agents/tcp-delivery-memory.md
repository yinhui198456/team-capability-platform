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

## 证据与状态放置

- 用户级规则在 `~/.codex/AGENTS.md`（Codex）和 `~/.claude/CLAUDE.md`（Claude Code）；项目即时规则在根 `AGENTS.md` / `CLAUDE.md`；本文件存 TCP 的稳定记忆。
- 当前任务状态在 GitHub Issue/PR、当前 Sol Goal/Plan 与可追溯验证证据；不要把它们沉淀进长期记忆。
- 产品变更的验收分为：独立专业审查、同版本自动化/E2E、真实 Chrome 交互、用户最终 UAT。每层记录自己的范围、结论和缺口，不混称为“已验收”。

## 维护规则

- 仅在事实已验证且预计跨 Issue 有效时更新；优先改短条目，不追加会议纪要、完整日志或重复指令。
- 协作拓扑、环境路径、权威文档或验收边界变更时，同步检查本文件、根 `AGENTS.md`/`CLAUDE.md` 和相关 `.claude/rules/` 是否仍一致。
