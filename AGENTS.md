# Team Capability Platform Delivery Rules

本文件是 Codex 在本仓库的完整项目指令；`CLAUDE.md` 仅供 Claude Code 回退使用。

## 产品与权威来源

- TCP 不是 LMS、考试、课程管理或绩效系统；所有功能服务于：Capability Model → Assessment → Gap Analysis → Growth Plan → Learning Task → Evidence → Buddy Review → Capability Profile。
- 权威顺序：`capability-model/`（业务规则）→ `docs/`（`01_Product.md`、`02_Design.md`、`03_Data.md`、`04_UI.md`、`05_Development.md`）→ `backend/` 与 `frontend/`。代码不得反向定义设计；规则缺失时停止并提问。
- 固定角色：Member、Buddy、Leader、Admin；固定名称：Growth Plan、Learning Task、Evidence、Buddy Review、Capability Profile。不得猜测业务规则、增加角色或核心业务对象。

## 布局与交付

- `backend/` 是 FastAPI/SQLAlchemy 与 pytest；迁移在 `backend/app/migrations/versions/`，由 `runner.py` 顺序注册。`frontend/` 是 React/TypeScript/Ant Design Pro，Vitest 测试与源码同置，Playwright 在 `frontend/tests/e2e/`。`docs/` 是设计与验收映射；`runtime/` 不是事实来源；`compose.yaml` 仅供本地开发。
- 后端命令（在 `backend/`）：`ruff check app tests && black --check app tests`、`pytest tests -q`、`pytest tests/test_<module>.py -v`。前端命令（在 `frontend/`）：`npm test`、`npm run test:e2e`，以及项目的 eslint/Prettier 脚本。
- 先理解、再设计、后实现；设计变更先更新 Markdown。以最小能产生可见结果的改动交付，不重构目录，也不添加“以后可能需要”的抽象。
- 一次仅一名写入者；提交、推送、PR、UAT 或部署仅在实时任务合同明确授权时执行。提交前核对本仓库 `origin`；不得 force-push 或跨 Issue/分支/运行时对象操作。
- 遇到凭据/MFA 缺失、疑似生产、删除/重置/恢复、目标或所有权不明、业务规则不明确、范围扩张或配置模式无法验证时停止并询问。绝不自动 Ready、merge、close 或发布。

## UI/UX 验收

- `docs/04_UI.md` 与 `docs/assets/ui-prototypes/UI-01..UI-05` 是 UI 验收基线。
- 权威原型要求响应式卡片、重排或时间轴时，不得用横向滚动的桌面表格或筛选条替代；各验收视口必须保持信息层级、控件语义和核心操作可达。
- 浏览器验收分为两层：自动 smoke 验证登录、导航和无权限反馈；截图对照验证原型的关键区域、信息层级与交互入口。两层结论必须分开记录。
- API、单元测试或页面可打开，均不能替代原型视觉验收。
- 浏览器测试默认只读；创建、编辑、提交或删除业务数据前，需获得本轮明确授权。

## UAT 与项目状态

- Codex 浏览器验收、用户 UAT 和发布决策是不同门禁。测试卡 `Done` 仅表示测试已执行；正文中的通过/失败结论决定是否可进入下一门禁。
- 将测试结论同步到 Git Project 时，写明测试范围、未执行的写操作、失败项和复验条件。
- UI-01、UI-04、UI-05 的原型差异修复后，先重跑浏览器 UI/UX 验收，再请求用户执行对应 UAT。

## 自动校验

- `scripts/uiux-smoke.py` 只覆盖稳定的浏览器行为契约；不要用脆弱的像素比对替代人工截图验收。
- 修改角色导航或权限反馈后，运行浏览器 smoke 与已有 `scripts/e2e-smoke.sh`。

## Ubuntu Codex CLI 协作

- Sol 控制者、Luna 监控者与 Terra 执行者必须作为独立 Codex 进程运行；禁止从开启 YOLO 的父会话派生子 Agent。
- Sol 与 Luna 保持只读：Sol 负责需求、审查和门禁；Luna 只做低成本状态核对。两者不得修改产品代码、运行状态型测试、操作容器或数据库。
- Luna 的常态监控由 `systemd --user` timer 调用独立、临时、只读的 Luna `codex exec --ephemeral`；持久 Luna TUI 仅用于明确的人工诊断，不作为默认常驻进程。
- 每个自动化任务合同必须明确目标、允许写入路径、允许检查、commit/push 授权、停止条件和通知目标；合同缺失时，Terra 不得启动。
- Terra 是唯一写入者，只能通过带全局 `flock` 的 TCP worker 启动器进入一个明确的 Issue worktree；YOLO 仅可用于该独立 Terra 单次任务。
- 同一时间只能有一个代码写入者和一个状态型测试/数据库栈。Claude Code 作为回退执行者时，不得与 Terra 同时写同一 worktree。
- 共享 Linux 账号下禁止使用 `pkill`、`killall` 或模糊进程匹配清理 Codex；生命周期操作必须先核对归属，并精确指向本试点的 tmux session 或 PID。
- 当前 Issue、SHA、检查状态和临时授权不写入本文件；以 GitHub Issue/PR/Actions 和当前任务合同为准。
- 禁止自动生产、Ready、merge、close。浏览器/UAT、共享数据库写入和破坏性清理仍需当前任务合同明确授权。
