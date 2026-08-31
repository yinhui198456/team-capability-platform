# Team Capability Platform — 项目级指令

本文件只放 TCP 每次会话都需遵循的短规则。设置或恢复 Issue、会话压缩后恢复、准备测试环境或交接时，先读取 `.agents/tcp-delivery-memory.md`；当前 Issue、SHA、CI、临时授权和会话状态以 GitHub Issue/PR 与当前 Goal/Plan 为准。

## 产品与权威来源

- TCP 服务于：Capability Model → Assessment → Gap Analysis → Growth Plan → Learning Task → Evidence → Buddy Review → Capability Profile；不是 LMS、考试、课程管理或绩效系统。
- 业务权威顺序：`capability-model/` → `docs/01_Product.md`、`02_Design.md`、`03_Data.md`、`04_UI.md`、`05_Development.md` → 代码。业务规则缺失时停止猜测并提出问题。
- 固定角色：Member、Buddy、Leader、Admin；固定核心对象：Growth Plan、Learning Task、Evidence、Buddy Review、Capability Profile。设计变更先改权威 Markdown，再改代码。

## 仓库布局与检查

- `backend/` 是 FastAPI/SQLAlchemy 与 pytest；迁移位于 `backend/app/migrations/versions/` 并由 `runner.py` 顺序注册。`frontend/` 是 React/TypeScript/Ant Design Pro；Vitest 与源码同置，Playwright 位于 `frontend/tests/e2e/`。
- 后端在 `backend/` 运行 `ruff check app tests && black --check app tests`、`pytest tests -q` 或直接相关测试。前端在 `frontend/` 运行项目的 Vitest、eslint/Prettier 与必要的 Playwright 检查。
- `runtime/` 不是事实来源；`compose.yaml` 仅供本地开发。实施应是产生完整可见结果的最小改动，不重构目录或增加未验证的抽象。

## 协作与变更边界

- Ubuntu 是 TCP coding、集成、测试、受控部署和真实 Chrome 验收的主场；每个活跃 Issue 同一时间只有一个被明确指定的 writer 与 commit/push owner。
- Sol 维护当前 Issue Goal/Plan、任务合同、门禁和验收编排，不旁路修改 Issue worktree。writer 可以是当前合同指定的独立 Writer；切换 writer 前须核对固定 pane、worktree、branch/HEAD 和干净状态，旧 writer 先停止写入。
- 默认由 Sol 创建一个只读 `combined_reviewer` 子会话；按任务增加 delivery、risk 或 visual 检查维度。只有确有独立并行收益或单一上下文过大时才拆分额外 reviewer。
- Reviewer 合同必须禁止写入；除非当前有界合同明确授权并隔离环境，Reviewer 不运行构建、浏览器、Docker/Compose、数据库、迁移或快照更新。工具权限不等于职责授权，未授权写入使该轮审查失效。
- 未经当前有界合同，不提交、推送、创建 PR、部署、UAT、合并、关闭 Issue 或修改共享运行环境。

## 项目记忆与 Git worktree

- `AGENTS.md` 与 `.agents/tcp-delivery-memory.md` 是同一 Git 仓库中的唯一逻辑路径；任一 checkout/worktree 只是对应分支的版本快照，不是第二份权威记忆。
- 经确认的跨 Issue 稳定事实，应在当前 Issue worktree 修改并随该分支提交、PR 审查及合并回基础分支；不得在主 checkout 与 Issue worktree 之间手工复制、双写或反向同步。
- 新 Issue worktree 应从已经包含最新项目记忆的基础提交创建。既有 worktree 不自动更新；只在安全检查点通过正常 merge/rebase 获得新基线。

## 验收与运行环境

- 长期用户测试环境、Issue writer 测试夹具和遗留隔离验收环境必须分开；只有当前 GitHub 环境合同指定的目标可写入、迁移或运行状态型测试。目标身份不明即停止。
- 阶段 4–7 以批准原型和阶段 1 需求矩阵为权威。专业前端审查、同版本 GitHub Actions/E2E、真实 Chrome 和用户最终 UAT 是互补证据，均不可相互替代。
- 同一精确候选的验收至少记录需求 ID、页面/状态/视口、证据、结论和未覆盖项。通用 smoke、截图、错误版本或 Agent 自述均不能替代需求级证据。
