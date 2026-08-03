# Issue #63 工程收口验收记录

> 本文件仅记录 Issue #63（学习执行与 Evidence 闭环）第三阶段工程收口范围、实际执行命令与结果，不定义或修改业务规则。
> 业务规则以 `docs/01_Product.md` 至 `docs/05_Development.md` 为准。

---

## 1. 收口范围

第三阶段唯一主题：跨角色关键业务 E2E、必要失败路径、三视口与文档收口。

- Member 执行链：年度计划详情、受限日期编辑（来源季度 / 来源月边界 + CAS）、学习任务六态迁移、日志追加 / 作废更正与 `actual_hours` 聚合、Evidence 草稿 / CAS / 提交、完成门禁（completion gate）。
- Buddy Evidence Review 闭环：独立队列、当前有效 Buddy 关系权限、「需补充 → 新版本 → 通过」、历史不可变、旧版本不回流；与 Assessment Review 路由 / 队列 / 结论 / 权限严格隔离。
- 失败路径：401 / 403、结构化 422、终态冻结、409 冲突恢复（输入保留 / 刷新 revision / 用户确认重试）、幂等重放不重复写入。
- 三视口：1280×800、1440×900、1920×1080，无横向溢出、操作区不遮挡、空态 / 错误态 / 加载态可见。

## 2. 交付物

| 类型 | 位置 |
|---|---|
| 跨角色 E2E（5 场景，真实 API/DB，固定夹具） | `frontend/tests/e2e/smoke/issue-63-execution-evidence.spec.ts`（E2E-63-01..05） |
| 生产缺陷修复：双角色 Buddy 评审历史 403 | `backend/app/planning/api.py` `get_task_evidence_reviews`（Member 路径 PermissionError 时回退 Buddy 路径） |
| 回归测试（红 → 绿） | `backend/tests/test_evidence_review.py`：`test_dual_role_buddy_can_view_assigned_member_task_review_history`、`test_dual_role_buddy_cannot_view_unassigned_member_task_review_history` |
| 文档一致性 | `docs/02_Design.md` §4/§6.4–6.6、`docs/03_Data.md` §3.15–3.18/3.22/§5.2/§6、`docs/04_UI.md`、`docs/05_Development.md`、`docs/acceptance/ITERATION_4/5` 路由与结论修正 |

## 3. 验证结果（本地，单栈）

| 命令/检查 | 结果 |
|---|---|
| `POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=15460 python3 -m pytest tests/test_evidence_review.py`（backend/） | 通过，16/16 |
| 受影响后端套件（test_evidence_review / test_evidence / test_evidence_execution / test_access_buddy） | 通过，47/47 |
| `ruff check` / `ruff format --check`（backend） | 通过 |
| 前端 `npx tsc -b` / `eslint` / `prettier --check`（issue-63 spec） | 通过 |
| E2E issue-63 全量（官方容器 `mcr.microsoft.com/playwright:v1.61.1-jammy`，Compose 单栈，同源 URL） | 通过，5/5 |
| E2E issue-62 buddy-review 受影响 shard | 通过，10/10 |

E2E 隔离约定：每场景每 attempt 使用独立年度（`E2E63_YEAR_BASE + n + retry*40`，CI 默认基线 2310，本地复跑用环境变量平移）；Evidence 内容 marker 携带年度，避免持久卷上历史残留污染队列选择。

同 SHA 的 Backend / Frontend / E2E GitHub Actions 为整体全量门禁；本地只跑新增目标与受影响 shard，不重复完整套件。

## 4. 已知缺陷与处置

- **P1（本轮已修复）**：双角色账号（生产种子为 Buddy 账号同时授予 Member 角色）访问 `GET /api/planning/learning-tasks/{task_id}/evidence-reviews` 时，Member 路径 403 导致 Buddy 看不到评审历史。先红（新增后端测试 `assert 403 == 200` 失败），后修复（Member 路径 PermissionError 时回退 Buddy 路径），转绿。
- **测试侧竞态（已修复，非产品缺陷）**：队列选择 helper 在 `reload` 后立即计数导致 0 候选；队列 marker 不携带年度导致持久卷残留同文本条目可被误选。

## 5. UAT 待办（未执行，不得视为通过）

- [ ] Member 在 `/growth/annual-plan` 完成受限日期编辑、任务六态操作、日志追加与作废更正、Evidence 草稿 / 提交的真实界面走查。
- [ ] Buddy 在 `/mentoring/evidence-review` 完成「需补充 → 新版本 → 通过」走查，确认历史与反馈展示。
- [ ] 三视口人工走查（E2E 已做语义断言与溢出检查，视觉细节仍需人工确认）。
- [ ] 409 冲突恢复界面文案与操作确认。

---

## 6. 停点

**Issue #63 第三阶段工程收口完成（本文件所列本地验证全部通过）。PR #71 保持 Draft；UAT 未开始；不得 Ready / merge / 部署 / 关闭 Issue。后续工作（#64 报表导出、#65 非生产性 P2 与测试精致度 backlog）不在本轮范围。**
