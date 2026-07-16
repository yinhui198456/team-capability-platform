# 迭代 3B 技术验收记录

> 本文件仅记录 3B 技术验收范围、实际执行命令与结果，不定义或修改业务规则。
> 业务规则以 `docs/01_Product.md` 至 `docs/05_Development.md` 为准。

---

## 1. 验收范围

迭代 3B：Assessment、Assessment Review、Gap 与年度计划生成门禁，绑定 UI-02 及 UI-04 自评复核子流程。

- **3B-1**：Assessment 草稿、提交与历史快照。
- **3B-2**：Buddy 自评复核闭环（认可 / 建议调整）。
- **3B-3**：Gap 自动生成、优先级维护与纳入计划候选标记。
- **3B-4**：年度计划生成统一门禁（后端策略 + 前端原因展示）。

不含：Growth Goal、Annual Growth Plan / Plan Item 真实创建、Learning Task、Evidence、Admin 管理页、SSO、注册、密码重置。

---

## 2. 关键 Commit

| 子任务 | Commit 范围 |
|---|---|
| 3B-1 | `b67dd6d..7171f4b` |
| 3B-2 | `235a882..306cca0` |
| 3B-3 | `611d3c7..2c77a98` |
| 3B-4 | `754020d..8d23b68` |

---

## 3. 技术验收命令与结果

执行环境：项目根目录 `/opt/personal-agent-workspace/team-capability-platform`，Docker Compose 已可用。

| 命令/检查 | 结果 |
|---|---|
| `docker compose up -d postgres` + `pg_isready` | 通过 |
| 后端 pytest | 通过，`127 passed` |
| 后端 `ruff check .` + `black --check .` | 通过 |
| 前端 `npm run test` | 通过，`32 passed` |
| 前端 `npm run lint` / `npm run build` / `npm run format:check` | 通过 |
| `git diff --check` | 通过，无输出 |
| `docker compose up -d --build` + `/ready` 就绪等待 | 通过 |

---

## 4. 端到端 Smoke 结果

```bash
# 1. 启动服务并登录 member
docker compose up -d --build
until curl -fsS http://localhost:18001/ready >/dev/null; do sleep 1; done
curl -fsS -c /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"member","password":"123456"}' | jq '.roles'
# => ["Member"]

# 2. 创建并提交 assessment
ASSESSMENT=$(curl -fsS -b /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/assessments \
  -H 'Content-Type: application/json' -d '{"year":2026}' | jq -r '.id')
curl -fsS -b /tmp/tcp_uat_cookies.txt -X PUT "http://localhost:18081/api/assessments/${ASSESSMENT}/draft" \
  -H 'Content-Type: application/json' \
  -d '{"details":[{"l3_code":"P01-L2A-L3A","current_level":2,"target_level":4,"evidence_note":"测试中","plan_candidate":true}]}'
curl -fsS -b /tmp/tcp_uat_cookies.txt -X POST "http://localhost:18081/api/assessments/${ASSESSMENT}/submit" \
  -H 'Content-Type: application/json' -d '{}'

# 3. 门禁应被阻塞
curl -fsS -b /tmp/tcp_uat_cookies.txt http://localhost:18081/api/planning/annual-plan-eligibility | jq .
# => { "eligible": false, "reason": "存在待复核的自评，请等待 Buddy 复核" }

# 4. Buddy 复核为“认可”
curl -fsS -c /tmp/tcp_buddy_cookies.txt -b /tmp/tcp_buddy_cookies.txt -X POST http://localhost:18081/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"buddy","password":"123456"}' >/dev/null
REVIEW_ID=$(curl -fsS -b /tmp/tcp_buddy_cookies.txt http://localhost:18081/api/assessments/reviews/pending | jq -r '.[0].id')
curl -fsS -b /tmp/tcp_buddy_cookies.txt \
  -X POST "http://localhost:18081/api/assessments/${ASSESSMENT}/reviews/${REVIEW_ID}" \
  -H 'Content-Type: application/json' \
  -d '{"conclusion":"认可","feedback":"符合预期"}'

# 5. Member 再次查询门禁应通过
curl -fsS -b /tmp/tcp_uat_cookies.txt http://localhost:18081/api/planning/annual-plan-eligibility | jq .
# => { "eligible": true, "reason": null }

# 6. 干跑生成年度计划成功
curl -fsS -b /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/planning/annual-plan-dry-run | jq .
# => { "ok": true }
```

---

## 5. 本地可访问地址

- 前端（Nginx 反向代理 `/api/`）：`http://localhost:18081`
- 登录页：`http://localhost:18081/login`
- 能力自评：`http://localhost:18081/capability/assessment`
- 评估历史：`http://localhost:18081/capability/assessment/history`
- Buddy 复核队列：`http://localhost:18081/mentoring/assessment-review`
- Gap 分析：`http://localhost:18081/capability/gap`
- 后端健康/就绪：`http://localhost:18001/health`、`http://localhost:18001/ready`
- PostgreSQL：`localhost:5432`，数据库 `tcp`，用户 `tcp`，开发密码 `tcp_dev_only`

本地 UAT 演示账号密码均为 `123456`，仅在本地开发/UAT 环境有效。

---

## 6. 3B 切片 UAT 检查清单（3B-5）

- [ ] 使用 `member` / `123456` 登录，进入 `/capability/assessment`，创建 2026 年度自评。
- [ ] 为某个 L3 设置当前掌握度 2、目标掌握度 4、自评依据、纳入计划候选，保存草稿。
- [ ] 提交自评，页面提示“已提交，等待 Buddy 复核”。
- [ ] 进入 `/capability/assessment/history`，确认刚提交的评估状态为“待复核”。
- [ ] 使用 `buddy` / `123456` 登录，进入 `/mentoring/assessment-review`，看到待复核队列。
- [ ] 打开该评估，提交“建议调整”并填写反馈。
- [ ] 使用 `member` 重新登录，确认评估状态为“建议调整”，可重新编辑依据并再次提交。
- [ ] 使用 `buddy` 再次复核，提交“认可”。
- [ ] 使用 `member` 登录，进入 `/capability/gap`，确认 Gap 列表已生成，默认优先级“中”。
- [ ] 在 Gap 页面将某个 Gap 优先级改为“高”，确认更新生效。
- [ ] 在 Gap 页面点击“模拟生成年度计划”，确认提示“可生成年度计划”。
- [ ] 重新提交一份新评估且不复核，确认 Gap 页面顶部显示阻塞原因，干跑按钮返回阻塞提示。
- [ ] 确认 `/api/planning/annual-plan-eligibility` 在阻塞时返回 `eligible=false` 与原因，通过后返回 `eligible=true`。

---

## 7. 停点

**3B CC 实施阶段已全部完成。下一动作：提交 Codex 审核；审核通过后由用户执行 3B-5 切片 UAT。在获得用户 UAT 确认前，不得启动迭代 4。**
