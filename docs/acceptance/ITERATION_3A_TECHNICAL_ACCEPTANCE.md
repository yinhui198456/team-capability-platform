# 迭代 3A 技术验收记录

> 本文件仅记录 3A 技术验收范围、实际执行命令与结果，不定义或修改业务规则。
> 业务规则以 `docs/01_Product.md` 至 `docs/05_Development.md` 为准。

---

## 1. 验收范围

迭代 3A：MVP 本地会话、演示账号与有效角色、Buddy 关系与后端权限基础，仅满足单团队 UAT 运行条件，不含 Admin 管理页。

不含 Assessment、Assessment Review、Gap、Growth Goal、Annual Growth Plan、Plan Item、Learning Task、Evidence、Buddy Review、Capability Profile、SSO、注册、密码重置。

---

## 2. 关键 Commit

- `c39283f` feat: seed uat demo accounts
- `e701305` feat: minimal uat login page
- 以及 3A-1..3A-6 的访问 Schema、scrypt 密码哈希/会话摘要、HttpOnly Cookie 认证、N:M 角色 401/403、Buddy 关系、匿名目录回归等 commit。

---

## 3. 技术验收命令与结果

执行环境：项目根目录，Docker Compose 已可用。

| 命令/检查 | 结果 |
|---|---|
| `docker compose up -d postgres` + `pg_isready` | 通过 |
| `docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/capability-model:ro" backend sh -c 'pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/'` | 通过，`101 passed` |
| `(cd backend && ../.venv/bin/ruff check . && ../.venv/bin/black --check .)` | 通过，All checks passed! / 28 files would be left unchanged. |
| `(cd frontend && npm run test && npm run lint && npm run build && npm run format:check)` | 通过，12 passed；lint/build/format 均通过 |
| `git diff --check` | 通过，无输出 |
| `docker compose up -d --build` + `/ready` 就绪等待 | 通过，容器健康 |

---

## 4. 端到端 Smoke 结果

```bash
# 能力模型域数
curl -fsS http://localhost:18081/api/capability-model | jq '.domains | length'
# => 6

# Member 登录，Cookie 写入 /tmp/tcp_uat_cookies.txt
curl -fsS -c /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"member","password":"123456"}' | jq '.roles'
# => ["Member"]

# Cookie 为 HttpOnly
grep -q 'HttpOnly' /tmp/tcp_uat_cookies.txt
# => 通过

# 当前用户与主 Buddy
curl -fsS -b /tmp/tcp_uat_cookies.txt http://localhost:18081/api/auth/me | jq '{username, roles, primary_buddy}'
# => {"username":"member","roles":["Member"],"primary_buddy":{"id":3,"username":"buddy",...}}

# 登出
curl -fsS -b /tmp/tcp_uat_cookies.txt -c /tmp/tcp_uat_cookies.txt -X POST http://localhost:18081/api/auth/logout | jq .
# => {"ok":true}

# 登出后 /me 返回 401
test "$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/tcp_uat_cookies.txt http://localhost:18081/api/auth/me)" = 401
# => 通过
```

---

## 5. 本地可访问地址

- 前端（Nginx 反向代理 `/api/`）：`http://localhost:18081`
- 登录页：`http://localhost:18081/login`
- 能力模型只读页：`http://localhost:18081/capability/model`
- 学习资源只读页：`http://localhost:18081/operations/resources`
- 后端健康/就绪：`http://localhost:18001/health`、`http://localhost:18001/ready`
- PostgreSQL：`localhost:5432`，数据库 `tcp`，用户 `tcp`，开发密码 `tcp_dev_only`

---

## 6. 3A UAT 检查清单

- [ ] 访问 `http://localhost:18081/login`，使用 `member` / `123456` 登录后跳转至 `/capability/model`。
- [ ] 未登录时直接访问 `/capability/model` 或 `/operations/resources` 仍可匿名查看（当前为匿名只读页）。
- [ ] 使用 `buddy` / `123456` 登录，确认 `GET /api/auth/me` 返回 `roles` 包含 `Buddy` 与 `Member`。
- [ ] 使用 `leader` / `123456` 登录，确认 `roles` 包含 `Leader` 与 `Member`。
- [ ] 使用 `admin` / `123456` 登录，确认 `roles` 包含 `Admin`、`Leader`、`Member`。
- [ ] 确认 `member` 的 `primary_buddy.username` 为 `buddy`。
- [ ] 确认登录 Cookie 为 `HttpOnly`，无 token 写入 localStorage。
- [ ] 点击登出后，`/api/auth/me` 返回 401。

本地 UAT 演示账号密码均为 `123456`，仅限本地开发/UAT 使用，不得用于生产环境。

---

## 7. 停点

**3B 未启动。下一动作为用户执行并确认 3A UAT；在获得用户确认前，不得开始任何 3B 业务功能。**
