# 迭代 5 技术验收记录

> 本文件仅记录迭代 5 技术验收范围、实际执行命令与结果，不定义或修改业务规则。
> 业务规则以 `docs/01_Product.md` 至 `docs/05_Development.md` 为准。

---

## 1. 验收范围

迭代 5：Evidence 版本、Evidence Review、Capability Profile 成长档案聚合，绑定 UI-03 的 Evidence 区、UI-04 的 Evidence Review 区及成长档案视图。

- **5-1**：Evidence 草稿、提交与版本。
- **5-2**：Buddy Evidence Review 与反馈历史。
- **5-3**：Capability Profile 成长档案聚合。

不含：UI-01 成长看板、UI-05 团队分析、Leader 能力模型/资源维护、Admin 管理页、消息通知、导出/打印、图表可视化。

**进入门禁说明**：用户已明确授权 override 迭代 5 进入门禁，4-5 UAT 延后验收，迭代 5 先行推进。

---

## 2. 关键 Commit

| 子任务 | Commit 范围 |
|---|---|
| 5-1 | `ee37a5f..564e856` |
| 5-2 | `c18858e..adcfbe3` |
| 5-3 | `c739718..034b622` |

---

## 3. 技术验收命令与结果

执行环境：项目根目录 `/opt/personal-agent-workspace/team-capability-platform`，Docker Compose 已可用。

| 命令/检查 | 结果 |
|---|---|
| 后端 pytest（容器内，全量 `tests/`） | 通过，`178 passed` |
| 后端 `ruff check .` + `black --check .` | 通过 |
| 前端 `npm run test` | 通过，`81 passed` |
| 前端 `npm run lint` / `npm run build` / `npm run format:check` | 通过 |

---

## 4. 端到端 Smoke 参考

前置：使用本地 UAT 演示账号 `member` / `123456` 登录，且已有 Learning Task（见迭代 4 验收记录第 4 节）。

```bash
# 1. 登录 member
curl -fsS -c /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"member","password":"123456"}' | jq '.roles'

# 2. 取一个 Learning Task，创建 Evidence 草稿
TASK=$(curl -fsS -b /tmp/tcp_uat_cookies.txt http://localhost:18081/api/planning/learning-tasks | jq -r '.[0].id')
EV=$(curl -fsS -b /tmp/tcp_uat_cookies.txt -X POST "http://localhost:18081/api/planning/learning-tasks/${TASK}/evidences" \
  -H 'Content-Type: application/json' \
  -d '{"content":"完成阅读并输出笔记","evidence_link":"https://example.com/note"}' | jq -r '.id')

# 3. 提交 Evidence（草稿 → 待 Review）
curl -fsS -b /tmp/tcp_uat_cookies.txt -X POST "http://localhost:18081/api/planning/evidences/${EV}/submit" | jq '{version_number,status}'

# 4. 登录 buddy，查看待 Review 队列并对 Evidence 提交 Review
curl -fsS -c /tmp/tcp_uat_cookies_buddy.txt -X POST http://localhost:18081/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"buddy","password":"123456"}' | jq '.roles'
curl -fsS -b /tmp/tcp_uat_cookies_buddy.txt http://localhost:18081/api/planning/evidence-reviews/pending | jq -r '.[].id'
# 注意：Review 提交针对 evidence id（上文 ${EV}），不是队列条目 id
curl -fsS -b /tmp/tcp_uat_cookies_buddy.txt -X POST "http://localhost:18081/api/planning/evidences/${EV}/review" \
  -H 'Content-Type: application/json' -d '{"conclusion":"通过","feedback":"证据充分"}' | jq .

# 5. member 查看 Capability Profile
curl -fsS -b /tmp/tcp_uat_cookies.txt 'http://localhost:18081/api/planning/profiles?year=2026' | jq '{year, statistics}'
```

---

## 5. 本地可访问地址

- 前端（Nginx 反向代理 `/api/`）：`http://localhost:18081`
- 登录页：`http://localhost:18081/login`
- 学习任务（含 Evidence 区）：`http://localhost:18081/growth/annual-plan`（`/growth/tasks` 已重定向至此）
- Evidence Review 队列（Buddy）：`http://localhost:18081/mentoring/evidence-review`
- 成长档案：`http://localhost:18081/growth/profile`
- 后端健康/就绪：`http://localhost:18001/health`、`http://localhost:18001/ready`

本地 UAT 演示账号密码均为 `123456`，仅在本地开发/UAT 环境有效。

---

## 6. 迭代 5 用户 UAT 检查清单（5-4）

### Evidence 草稿与版本（5-1）

- [ ] 使用 `member` / `123456` 登录，进入 `/growth/annual-plan`（原 `/growth/tasks` 已重定向），确认任一学习任务下出现 Evidence 区。
- [ ] 新增 Evidence 草稿（内容 + 链接），确认出现在列表中，状态为“草稿”，版本号为 1。
- [ ] 编辑草稿内容并保存，确认内容更新、版本号不变。
- [ ] 点击“提交”，确认状态变为“待 Review”，且草稿不再可编辑。
- [ ] 提交后再次新增 Evidence，确认生成版本 2 草稿；旧版本保持只读。

### Buddy Evidence Review（5-2）

- [ ] 使用 `buddy` / `123456` 登录，进入 `/mentoring/evidence-review`，确认待 Review 队列包含负责成员提交的 Evidence。
- [ ] 对一条 Evidence 提交 Review（结论：通过 / 需补充 任选；需补充必须附反馈），确认该条从待 Review 队列消失。
- [ ] 回到 `member` 账号 `/growth/annual-plan`（原 `/growth/tasks` 已重定向），确认对应 Evidence 版本显示 Review 结论与反馈。
- [ ] 对“需补充”的 Evidence 由 member 提交新版本，确认新版本进入 buddy 待 Review 队列，旧版本 Review 记录保留不回流。
- [ ] 确认 buddy 看不到非负责成员的 Evidence Review 队列项。

### Capability Profile 成长档案（5-3）

- [ ] 使用 `member` 登录，进入 `/growth/profile`，确认页面展示 2026 年度档案：成员信息、Assessment 历史、年度成长计划、Plan Item → Learning Task → Evidence/Review/日志的聚合视图。
- [ ] 确认页面显示年度总学习时长与 Evidence 状态统计，数值与 `/growth/annual-plan`（原 `/growth/tasks`）、`/growth/review/monthly` 中的数据一致。
- [ ] 使用 `buddy` 登录，确认可查看负责成员的成长档案（通过 API `/api/planning/profiles?member_id=<id>&year=2026` 或页面入口）。
- [ ] 确认 `buddy` 查看非负责成员档案返回 403。
- [ ] 确认未登录访问 `/growth/profile` 会被引导至登录页。

### 权限与约束回归

- [ ] 确认非 Member 角色无法在 `/growth/annual-plan`（原 `/growth/tasks`）创建/编辑 Evidence。
- [ ] 确认 Evidence 与其 Learning Task 严格关联，不能跨任务挂载。
- [ ] 确认 Review 与 Evidence 版本 1:1，同一版本不能被重复 Review。

---

## 7. 停点

**迭代 5 CC 实施阶段已全部完成（5-1/5-2/5-3 均通过 Codex 审核）。下一动作：由用户执行 5-4 切片 UAT。在获得用户 UAT 确认前，不得启动迭代 6；迭代 4 的 4-5 UAT 仍待用户一并验收。**
