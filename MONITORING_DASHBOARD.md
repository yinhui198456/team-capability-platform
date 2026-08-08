# Team Capability Platform - 监控仪表板

**会话ID**: 当前会话  
**启动时间**: 2026-08-08 23:01+  
**项目**: team-capability-platform

---

## 活跃监控器

### 1. E2E测试完成监控
- **任务ID**: b8jishsi4
- **类型**: 一次性 (10分钟超时)
- **目标**: 监控266个Playwright E2E测试完成
- **触发条件**: playwright进程全部退出
- **输出**: 测试通过/失败统计

```bash
while ps aux | grep -q "[p]laywright"; do sleep 10; done && \
echo "E2E tests completed" && \
tail -30 /tmp/e2e-test.log 2>/dev/null | grep -E "passed|failed|Test Files"
```

---

### 2. Backend错误日志监控
- **任务ID**: bx6t211nn
- **类型**: 持久化 (1小时)
- **目标**: 实时捕获Backend应用错误
- **过滤**: ERROR, CRITICAL, Exception, Traceback, failed
- **日志路径**: `backend/logs/app.log`

```bash
tail -f backend/logs/app.log | grep -E --line-buffered "ERROR|CRITICAL|Exception|Traceback|failed"
```

---

### 3. Backend容器日志监控
- **任务ID**: bxiduylt9
- **类型**: 持久化 (1小时)
- **目标**: 监控Docker容器运行状态和错误
- **过滤**: ERROR, WARNING, Exception, Traceback, CRITICAL, failed to start, exit code
- **来源**: docker compose logs -f backend

```bash
docker compose logs -f backend 2>&1 | \
grep -E --line-buffered "ERROR|WARNING|Exception|Traceback|CRITICAL|failed to start|exit code"
```

---

### 4. 服务健康状态监控
- **任务ID**: bt2k01bfo
- **类型**: 持久化 (1小时)
- **目标**: 检测Backend和Postgres服务异常状态
- **检查频率**: 每30秒
- **告警条件**: 服务状态为 exited, dead, 或 restarting

```bash
while true; do
  status=$(docker compose ps --format json | \
    jq -r '.[] | select(.Service=="backend" or .Service=="postgres") | "\(.Service): \(.State)"')
  if echo "$status" | grep -qE "exited|dead|restarting"; then
    echo "$status"
  fi
  sleep 30
done
```

---

### 5. 资源使用监控
- **任务ID**: b3bqqlsap
- **类型**: 持久化 (1小时)
- **目标**: 监控磁盘和内存使用率
- **检查频率**: 每60秒
- **告警阈值**: 磁盘 > 85%, 内存 > 85%

```bash
while true; do
  disk=$(df -h /opt/personal-agent-workspace | tail -1 | awk '{print $5}' | tr -d '%')
  mem=$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')
  
  if [ "$disk" -gt 85 ] || [ "$mem" -gt 85 ]; then
    echo "⚠️  Resource alert - Disk: ${disk}%, Memory: ${mem}%"
  fi
  sleep 60
done
```

---

## 监控覆盖范围

### ✅ 已覆盖
- E2E测试执行状态
- Backend应用错误
- Docker容器健康状态
- 系统资源使用

### 📋 可扩展监控点

#### 数据库监控
```bash
# 连接数监控
while true; do
  conns=$(docker compose exec -T postgres psql -U postgres -d tcp_dev \
    -c "SELECT count(*) FROM pg_stat_activity;" -t 2>/dev/null | tr -d ' ')
  if [ "$conns" -gt 80 ]; then
    echo "⚠️  High DB connections: $conns"
  fi
  sleep 60
done
```

#### API响应时间监控
```bash
# 健康检查端点延迟
while true; do
  response_time=$(curl -o /dev/null -s -w '%{time_total}\n' http://localhost:8000/health)
  if [ "$(echo "$response_time > 2" | bc)" -eq 1 ]; then
    echo "⚠️  Slow API response: ${response_time}s"
  fi
  sleep 30
done
```

#### Git状态监控
```bash
# 未提交更改监控
while true; do
  if [ -n "$(git status --porcelain)" ]; then
    uncommitted=$(git status --porcelain | wc -l)
    echo "📝 Uncommitted changes: $uncommitted files"
  fi
  sleep 300
done
```

#### Frontend构建监控
```bash
# npm run dev 错误监控
cd frontend && npm run dev 2>&1 | \
grep -E --line-buffered "ERROR|Failed|Cannot|ENOENT|compilation failed"
```

---

## 管理命令

### 查看所有监控任务
```bash
# Claude Code内置命令
/tasks
```

### 停止特定监控
```bash
# 使用TaskStop工具
TaskStop(task_id="<task_id>")
```

### 停止所有持久化监控
```bash
TaskStop(task_id="bx6t211nn")  # Backend错误日志
TaskStop(task_id="bxiduylt9")  # Backend容器日志
TaskStop(task_id="bt2k01bfo")  # 服务健康状态
TaskStop(task_id="b3bqqlsap")  # 资源使用
```

---

## 告警历史

### 2026-08-08
- 23:01 - E2E测试启动 (266个测试)
- 23:01 - 所有监控器启动成功
- 等待测试完成通知...

---

## 最佳实践

1. **监控器生命周期**
   - 一次性任务: 用于等待特定事件完成 (测试、构建、部署)
   - 持久化任务: 用于会话期间的持续监控 (日志、健康检查)

2. **过滤策略**
   - 使用`grep --line-buffered`确保实时输出
   - 只监控关键事件,避免噪音
   - 告警阈值设置合理,避免误报

3. **资源管理**
   - 监控命令本身要轻量
   - 适当的检查频率 (不要过于频繁)
   - 会话结束时自动清理

4. **通知响应**
   - Monitor通知不是用户回复,是后台事件
   - 收到告警后分析根因
   - 必要时调整监控阈值

---

**更新时间**: 2026-08-08 23:05
