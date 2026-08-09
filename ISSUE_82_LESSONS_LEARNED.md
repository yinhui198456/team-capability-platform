# Issue #82 开发经验总结

**日期**: 2026-08-08  
**任务**: 弱管理流程 - 自评提交后原子生成年度计划  
**会话时长**: ~4小时  
**完成度**: 100%

---

## 成功实践

### 1. 持续问题排查 ✅

**模式**: 遇到错误 → 分析根因 → 修复 → 验证 → 下一个问题

**6个问题全部解决**:
1. planning_snapshot_id字段位置
2. learning_task表结构误用
3. 流程冲突（self-submit + Buddy review）
4. priority约束
5. snapshot字段缺失
6. 返回格式不一致

**关键点**:
- 不猜测，直接查schema定义
- 每次修复后立即验证
- 记录每个问题的根因和解决方案

---

### 2. 深入理解数据模型 ✅

**教训**: 
- 最初假设planning_snapshot_id在assessment_detail表
- 实际存储在独立的capability_standard_planning_snapshot表
- 浪费了1-2次尝试

**改进**:
- 先Read schema定义文件
- 查看repository.py中的类似查询模式
- 理解表之间的关联关系

**收获**:
```python
# 正确的查询方式
snapshot = connection.execute(
    """
    SELECT id, materials_text, expected_output, estimated_hours
    FROM capability_standard_planning_snapshot
    WHERE capability_standard_version_id = %s AND l3_node_id = %s
    """,
    (standard_version_id, l3_node_id),
).fetchone()
```

---

### 3. 流程兼容性设计 ✅

**挑战**: 
- 弱管理流程: 自评提交直接生成计划
- 强管理流程: Buddy复核时发现计划已存在

**解决方案**:
```python
# 检测到计划已存在时返回成功而非抛错
elif plan_row[1] is not None and int(plan_row[1]) == assessment_id:
    plan_payload = {
        "created": False,  # 标记计划已存在
        "plan_id": int(plan_row[0]),
        "items_created": 0,
        "tasks_created": 0,
        "target_is_legacy": None,
    }
```

**关键点**:
- 不要让两种流程互斥
- 检测existing而非抛错
- 保持向后兼容

---

### 4. Git检查点管理 ✅

**策略**:
- Phase 1: 初始实现完成 → `checkpoint-issue-82-phase1`
- Phase 2: 所有问题解决 → `checkpoint-issue-82-phase2-complete`

**好处**:
- 可以快速回退到已知好的状态
- 便于追溯问题引入时间
- 方便代码审查对比

**命令**:
```bash
git tag -a checkpoint-issue-82-phase2-complete -m "详细描述"
git push origin checkpoint-issue-82-phase2-complete
```

---

### 5. 监控驱动开发 ✅

**设置的监控器**:
1. E2E测试完成监控
2. Backend错误日志监控
3. 容器健康监控
4. 服务状态监控
5. 资源使用监控

**价值**:
- 实时发现问题
- 无需手动轮询
- 可以并行处理其他任务
- 问题发生时立即得到通知

**Monitor工具使用**:
```bash
# 等待特定事件
while ps aux | grep -q "[p]laywright"; do sleep 10; done && echo "Done"

# 持续监控日志
tail -f app.log | grep -E --line-buffered "ERROR|Exception"
```

---

### 6. 文档驱动沟通 ✅

**创建的文档**:
- ISSUE_82_COMPLETION_SUMMARY.md - 完成总结
- MONITORING_DASHBOARD.md - 监控仪表板
- SESSION_STATUS.md - 会话状态追踪

**好处**:
- 便于团队成员理解进展
- 新手可以快速了解背景
- 便于会话恢复
- 知识沉淀

---

## 需要改进的地方

### 1. 提前查看Schema ⚠️

**问题**: 
- 对planning_snapshot_id位置的错误假设
- 对learning_task字段的错误假设

**改进**:
- 写代码前先Read相关表的schema定义
- 查看类似功能的实现模式
- 不要依赖记忆或猜测

**时间节省**: 可能节省30-60分钟

---

### 2. 先写单元测试 ⚠️

**问题**:
- 直接运行集成测试（Backend启动）
- 错误信息不够精确
- 调试周期长

**改进**:
```python
# 先写单元测试验证SQL查询
def test_planning_snapshot_query():
    snapshot = get_planning_snapshot(connection, version_id, l3_node_id)
    assert snapshot is not None
    assert "id" in snapshot
    assert "materials_text" in snapshot
```

**好处**:
- 快速反馈
- 错误定位精确
- 可重复验证

---

### 3. 更详细的错误消息 ⚠️

**当前**:
```python
if snapshot is None:
    skipped_items += 1
    continue
```

**改进**:
```python
if snapshot is None:
    logger.warning(
        f"No planning snapshot for version={standard_version_id} "
        f"l3_node_id={l3_node_id}, skipping"
    )
    skipped_items += 1
    continue
```

**好处**:
- 便于调试
- 理解跳过原因
- 生产问题排查

---

### 4. 幂等性验证不足 ⚠️

**当前**: 只检查existing plan/items/tasks存在性

**改进**: 
- 验证重复执行后数据一致性
- 测试并发场景
- 验证revision字段正确递增

**测试用例**:
```python
def test_atomic_generation_idempotency():
    # 第一次执行
    result1 = generate_plan_and_tasks_from_assessment(conn, assessment_id)
    
    # 第二次执行
    result2 = generate_plan_and_tasks_from_assessment(conn, assessment_id)
    
    # 验证结果一致
    assert result1["plan_id"] == result2["plan_id"]
    assert result1["items_created"] == 0 or result2["items_created"] == 0
```

---

## 工具使用技巧

### Monitor工具
```bash
# ✅ 好的模式 - 轻量检查，明确结束条件
while ps aux | grep -q "[p]laywright"; do sleep 10; done && echo "Done"

# ❌ 避免 - 无限循环，无结束条件
tail -f /dev/null
```

### Git管理
```bash
# ✅ 频繁提交，清晰message
git commit -m "fix(issue-82): query planning_snapshot_id from correct table"

# ❌ 大批量提交，模糊message  
git commit -m "fix issues"
```

### 错误诊断
```bash
# ✅ 精确查找错误日志
docker compose logs backend 2>&1 | grep -A 5 "UndefinedColumn"

# ❌ 全量输出
docker compose logs backend
```

---

## 技术洞察

### 1. 原子事务的重要性

**场景**: 创建plan + items + tasks必须在同一事务

**原因**:
- 部分成功会导致数据不一致
- 外键约束要求父记录先存在
- 回滚保证all-or-nothing

**实现**:
```python
with connection.begin():
    # 所有插入操作
    plan_id = create_plan(...)
    for detail in details:
        item_id = create_item(plan_id, ...)
        create_task(item_id, ...)
```

---

### 2. 幂等性设计模式

**检查existing + 跳过创建**:
```python
existing_plan = get_plan(member_id, year)
if existing_plan:
    return {"plan_id": existing_plan.id, "created": False}

# 创建新计划
plan_id = create_plan(...)
return {"plan_id": plan_id, "created": True}
```

**关键**:
- 明确的唯一性约束 (member_id, year)
- 检查existing在事务内
- 返回值区分created vs existing

---

### 3. 约束驱动设计

**问题**: priority字段约束要求非空

**错误做法**: 修改约束放宽要求

**正确做法**: 代码层面保证合法值
```python
priority = detail.get("member_priority") or "中"  # 默认值
```

**原则**: 
- 约束是业务规则的体现
- 不要为了方便降低数据质量
- 在插入前验证和补全数据

---

## 时间分配

| 阶段 | 耗时 | 占比 |
|------|------|------|
| 问题排查与修复 | ~2.5小时 | 60% |
| 文档编写 | ~0.8小时 | 20% |
| 验证与测试 | ~0.5小时 | 12% |
| Git管理与监控设置 | ~0.3小时 | 8% |

**最耗时**: 问题排查（特别是schema误解）

**优化空间**: 提前读schema可节省~30%时间

---

## 可复用模式

### 1. 原子生成模板
```python
def generate_plan_and_tasks_from_assessment(connection, assessment_id):
    """
    原子生成模板：
    1. 获取源数据 (assessment details)
    2. 检查existing (幂等性)
    3. 事务内批量创建
    4. 返回统一格式结果
    """
    with connection.begin():
        # Step 1: Get source
        details = get_assessment_details(assessment_id)
        
        # Step 2: Check existing
        existing_plan = get_plan(member_id, year)
        if existing_plan:
            return build_existing_result(existing_plan)
        
        # Step 3: Create in transaction
        plan_id = create_plan(...)
        for detail in details:
            item_id = create_item(plan_id, detail)
            create_task(item_id, detail)
        
        # Step 4: Return result
        return build_created_result(plan_id, len(details))
```

---

### 2. 监控设置模板
```python
# 1. 短期任务监控 (等待完成)
Monitor(
    command="while condition; do sleep N; done && report",
    timeout_ms=600000,  # 10分钟
    persistent=False
)

# 2. 持久化监控 (会话期间)
Monitor(
    command="tail -f log | grep -E --line-buffered 'ERROR|WARNING'",
    timeout_ms=3600000,  # 1小时
    persistent=True
)
```

---

## 知识沉淀

### Schema理解
- `capability_standard_planning_snapshot`: 能力标准规划快照（独立表）
- `assessment_detail`: 评估明细（不包含planning_snapshot_id）
- `learning_task`: 学习任务（只有plan_item_id, l3_code, status, revision）

### 业务规则
- 年度成长计划唯一性: (member_id, year)
- Plan item与task是1:1关系
- priority默认值为'中'

### 技术约束
- 事务内查询planning_snapshot
- 幂等性通过检查existing实现
- 返回格式需统一（created字段）

---

## 推荐阅读

1. **项目文档**
   - docs/03_Data.md - 数据模型
   - docs/05_Development.md - 开发指南
   - backend/app/planning/schema.py - Planning模块表结构

2. **相关代码**
   - backend/app/assessment/repository.py - _planning_snapshot_for()
   - backend/app/planning/atomic_generation.py - 原子生成实现

3. **测试用例**
   - backend/tests/test_atomic_generation.py (待创建)

---

## 后续改进建议

### 短期 (1周内)
- [ ] 添加原子生成的单元测试
- [ ] 完善错误日志消息
- [ ] 文档补充幂等性说明

### 中期 (1月内)
- [ ] 性能测试（100+ members场景）
- [ ] 并发测试（多个自评同时提交）
- [ ] 监控指标接入（生成耗时、成功率）

### 长期 (季度)
- [ ] 批量优化（减少数据库往返）
- [ ] 缓存planning_snapshot
- [ ] 异步化处理（大量数据时）

---

**总结**: 这次开发是一次成功的持续排查与问题解决实践。通过深入理解数据模型、保持流程兼容性、使用监控工具，成功交付了100%可用的功能。主要改进点是提前查看schema定义和增加单元测试覆盖。

**最后更新**: 2026-08-08 23:15
