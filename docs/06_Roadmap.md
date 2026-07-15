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
| 3 | **3A**：MVP 本地会话、演示账号/有效角色、Buddy 关系与后端权限基础，仅满足单团队 UAT 运行条件，不含 Admin 管理页；**3B**：Assessment、Assessment Review、Gap 与年度计划生成门禁，绑定 UI-02 及 UI-04 自评复核子流程 | 待用户确认 | 3A 进入门禁：迭代 2 验收通过；3A 验收门禁：本地会话、演示账号/角色、Buddy 关系、权限基础可运行；3B 进入门禁：3A 通过；3B 验收门禁：自评历史、Review 闭环、阻塞/解除场景通过，且该切片 UAT 通过 | 下一动作：用户确认后由 Codex 指派 CC 启动 3A；3A 完成后自动进入 3B；Admin 管理页不在 3A |
| 4 | Growth Goal、Annual Growth Plan、Plan Item、Learning Task、Learning Progress Log | 待开始 | 进入门禁：迭代 3 验收通过；验收门禁：1:1 任务关系和时长聚合场景通过，且该切片 UAT 通过 | 依赖迭代 3 完成；原型绑定 UI-03 的 Goal/计划/任务/日志子流程 |
| 5 | Evidence 版本、Evidence Review、成长档案聚合 | 待开始 | 进入门禁：迭代 4 验收通过；验收门禁：旧版本不回流、Review 历史闭环，且该切片 UAT 通过 | 依赖迭代 4 完成；原型绑定 UI-03 的 Evidence 区、UI-04 的 Evidence Review 区及成长档案 |
| 6 | **6A**：UI-01 我的成长看板，以及 UI-02～UI-04 的成员/Buddy 视觉与交互整合；**6B**：UI-05 团队能力分析、Leader 能力模型/学习资源维护与团队年度能力规划、Admin 用户/角色/系统设置管理，以及有效角色权限验收 | 待开始 | 6A 进入门禁：迭代 5 验收通过；6A 验收门禁：UI-01 与 UI-02～UI-04 视觉交互整合通过；6B 进入门禁：6A 通过；6B 验收门禁：五张原型截图与集成 UAT 通过 | 依赖迭代 5 完成；6A 完成后进入 6B；只有 6A/6B 均完成后五张原型截图和集成 UAT 才通过 |
| 7 | 种子数据、端到端回归、容器重启、日志与文档硬化 | 待开始 | 进入门禁：迭代 6 验收通过；验收门禁：端到端场景全通过，完成最终 UAT/发布决策 | 依赖迭代 6 完成 |

---

## 3. 当前快照

- **当前迭代**：迭代 2 已完成，等待用户确认迭代 3；迭代 3 仍未启动，3A/3B 均未产生任何代码、API、数据库或页面实现。
- **迭代 3 子阶段**：3A 负责 MVP 本地会话、演示账号/有效角色、Buddy 关系与后端权限基础，不含 Admin 管理页；3B 负责 Assessment、Assessment Review、Gap 与年度计划生成门禁，绑定 UI-02 及 UI-04 自评复核子流程；3B 依赖 3A。
- **迭代 6 子阶段**：6A 负责 UI-01 及 UI-02～UI-04 的成员/Buddy 视觉与交互整合；6B 负责 UI-05、Leader 能力模型/学习资源维护与团队年度能力规划、Admin 用户/角色/系统设置管理，以及有效角色权限验收；6B 依赖 6A；只有 6A/6B 均完成后五张原型截图和集成 UAT 才通过。
- **UAT 节奏**：迭代 3 起，每个业务纵向切片在 Codex 验收通过后进入用户 UAT；UAT 反馈只修复当前已授权切片范围，不新增业务规则。
- **迭代 2 完成边界**：仅交付能力模型与学习资源目录的匿名只读展示，不含登录账号、Assessment、Gap、Goal、Plan、Task、Evidence、Review 或其他业务写入功能。
- **可验证入口**：
  - 能力模型只读页：`/capability/model`
  - 学习资源只读页：`/operations/resources`
  - 只读 API：`GET /api/capability-model`、`GET /api/learning-resources`、`GET /api/learning-resources/{material_code}`
  - 健康检查：`/health`、`/ready`
  - 后端与前端测试：按对应迭代的验收记录（如 README 或 `compose.yaml` 中记录的容器化测试方式）执行，不承诺在宿主目录直接运行。
- **下一决策点**：是否授权启动迭代 3。

---

## 4. 每次项目汇报固定格式

1. **当前迭代**：当前处于哪个迭代，状态是什么。
2. **门禁**：该迭代的进入门禁与验收门禁是否通过。
3. **证据**：可追溯的文档、commit 范围、测试或运行入口。
4. **下一步 / 需要用户决策**：下一动作及是否需要用户确认。

---

## 5. 下一个授权动作

**用户确认后，由 Codex 指派 CC 开始迭代 3 的 3A。**

迭代 3 范围严格限定为：

- **3A**：MVP 本地会话、演示账号与有效角色、Buddy 关系与后端权限基础，只满足单团队 UAT 运行条件，不是完整 Admin 管理页。
- **3B**：Assessment（能力自评）的创建、草稿、提交与历史快照；Assessment Review（自评复核）的闭环流程，结论为「认可」或「建议调整」；Gap 的自动生成、分级、优先级与纳入计划标记；年度计划生成门禁策略：`05_Development.md` 第 3.1 节原文。
- 3B 依赖 3A；3A 完成后自动进入 3B。

未获用户确认前，不启动迭代 3 的任何代码、API、数据库或页面实现。

---

## 6. 敏捷更新纪律

1. 一次迭代只交付一个可演示的纵向切片，不跨迭代预装后续范围。
2. 每个迭代按 CC 实施与测试 → Codex 审核 → 用户 UAT 的节奏推进。
3. UAT 反馈只修复当前已授权切片范围内的缺陷或体验问题，不新增业务规则。
4. 每次门禁结果（通过 / 阻塞 / 待确认）同步更新本文档与项目看板。
5. 每个主迭代启动时拆分为 3–6 张可验收子任务；WIP=1；只在子任务准入条件满足后开始。
