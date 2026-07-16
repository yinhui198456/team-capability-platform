# 迭代 4 技术验收记录

> 本文件仅记录迭代 4 技术验收范围、实际执行命令与结果，不定义或修改业务规则。
> 业务规则以 `docs/01_Product.md` 至 `docs/05_Development.md` 为准。

---

## 1. 验收范围

迭代 4：Growth Goal、Annual Growth Plan、Plan Item、Learning Task、Learning Progress Log，绑定 UI-03 的 Goal/计划/任务/日志子流程。

- **4-1**：Growth Goal 与 Gap 纳入。
- **4-2**：年度成长计划与 Plan Item 生成。
- **4-3**：Learning Task 1:1 与执行管理。
- **4-4**：Learning Progress Log 与时长聚合。

不含：Evidence、Evidence Review、成长档案、工时审批、Buddy/Leader 查看范围扩展、跨年聚合。

---

## 2. 关键 Commit

| 子任务 | Commit 范围 |
|---|---|
| 4-1 | `e4013b6..d354a37` |
| 4-2 | `bf57767..93839fd` |
| 4-3 | `bb1c602..44f0358` |
| 4-4 | `d4183f5..a090195` |

---

## 3. 技术验收命令与结果

执行环境：项目根目录 `/opt/personal-agent-workspace/team-capability-platform`，Docker Compose 已可用。

| 命令/检查 | 结果 |
|---|---|
| `docker compose up -d postgres` + `pg_isready` | 通过 |
| 后端 pytest | 通过，`150 passed` |
| 后端 `ruff check .` + `black --check .` | 通过 |
| 前端 `npm run test` | 通过，`64 passed` |
| 前端 `npm run lint` / `npm run build` / `npm run format:check` | 通过 |
| `git diff --check` | 通过，无输出 |

---

## 4. 端到端 Smoke 结果

前置：使用本地 UAT 演示账号 `member` / `123456` 登录，且已通过 3B 复核并生成 Gap。

```bash
# 1. 启动服务并登录 member
docker compose up -d --build
until curl -fsS http://localhost:18001/ready >/dev/null; do sleep 1; done
curl -fsS -c /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"member","password":"123456"}' | jq '.roles'
# => ["Member"]

# 2. 从合格 Gap 创建 Growth Goal（若尚未创建）
GAP=$(curl -fsS -b /tmp/tcp_uat_cookies.txt http://localhost:18081/api/planning/eligible-gaps | jq -r '.[0].id')
curl -fsS -b /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/planning/growth-goals \
  -H 'Content-Type: application/json' -d "{\"gap_id\":${GAP}}" | jq .

# 3. 生成年度计划与 Plan Items
curl -fsS -b /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/planning/annual-plan/generate | jq .

# 4. 为第一个 Plan Item 创建 Learning Task
ITEM=$(curl -fsS -b /tmp/tcp_uat_cookies.txt http://localhost:18081/api/planning/plan-items | jq -r '.[0].id')
TASK=$(curl -fsS -b /tmp/tcp_uat_cookies.txt -X POST "http://localhost:18081/api/planning/plan-items/${ITEM}/learning-task" | jq -r '.id')

# 5. 创建学习日志
curl -fsS -b /tmp/tcp_uat_cookies.txt -X POST "http://localhost:18081/api/planning/learning-tasks/${TASK}/progress-logs" \
  -H 'Content-Type: application/json' \
  -d '{"record_date":"2026-07-10","actual_hours":3,"note":"阅读文档"}' | jq .

# 6. 列出日志
curl -fsS -b /tmp/tcp_uat_cookies.txt "http://localhost:18081/api/planning/learning-tasks/${TASK}/progress-logs" | jq .

# 7. 月度时长聚合
curl -fsS -b /tmp/tcp_uat_cookies.txt 'http://localhost:18081/api/planning/progress-logs/monthly?year=2026' | jq .
```

---

## 5. 本地可访问地址

- 前端（Nginx 反向代理 `/api/`）：`http://localhost:18081`
- 登录页：`http://localhost:18081/login`
- 成长目标：`http://localhost:18081/growth/goals`
- 年度成长计划：`http://localhost:18081/growth/annual-plan`
- 学习任务：`http://localhost:18081/growth/tasks`
- 月度复盘：`http://localhost:18081/growth/review/monthly`
- 后端健康/就绪：`http://localhost:18001/health`、`http://localhost:18001/ready`
- PostgreSQL：`localhost:5432`，数据库 `tcp`，用户 `tcp`，开发密码 `tcp_dev_only`

本地 UAT 演示账号密码均为 `123456`，仅在本地开发/UAT 环境有效。

---

## 6. 迭代 4 用户 UAT 检查清单（4-5）

- [ ] 使用 `member` / `123456` 登录，确认顶部导航出现“成长目标”“年度成长计划”“学习任务”“月度复盘”。
- [ ] 进入 `/growth/goals`，确认页面列出“合格 Gap”与“已创建的成长目标”。
- [ ] 选择一个尚未创建目标的 Gap，点击创建，确认目标出现在“已创建的成长目标”列表。
- [ ] 在成长目标页面删除一个目标，确认目标被移除。
- [ ] 进入 `/growth/annual-plan`，确认 2026 年度成长计划及按 L3 生成的 Plan Item 列表。
- [ ] 若年度 plan 不存在，点击“生成年度计划”，确认 Plan Items 生成成功。
- [ ] 进入 `/growth/tasks`，确认“待创建学习任务的计划项”与“我的学习任务”两个区域。
- [ ] 为一个尚未创建任务的 Plan Item 点击“创建学习任务”，确认该计划项移动到“我的学习任务”。
- [ ] 修改一个 Learning Task 的状态、实际开始/完成日期、实际耗时、下步动作，确认更新保存。
- [ ] 在一个 Learning Task 下新增学习日志（日期、时长、备注），确认日志出现在列表，总时长随之更新。
- [ ] 删除一条学习日志，确认日志被移除，总时长恢复。
- [ ] 为多个任务添加不同月份的学习日志，进入 `/growth/review/monthly`，确认各月总时长正确聚合。
- [ ] 确认非 Member 角色（如 `buddy` / `123456`）无法进入 `/growth/*` 页面或调用相关 API。
- [ ] 确认 `Plan Item → Learning Task` 为 1:1：同一个 Plan Item 不能创建第二个 Learning Task。
- [ ] 确认 `/api/planning/progress-logs/monthly?year=2026` 只返回当前登录 Member 自己的时长聚合。

---

## 7. 停点

**迭代 4 CC 实施阶段已全部完成，4-4 已在本窗口完成 Codex 审核。下一动作：由用户执行 4-5 切片 UAT。在获得用户 UAT 确认前，不得启动迭代 5。**
