# Issue #82 静默执行风险清单

## 🔴 高风险 - 可能导致中断

### 1. 数据库Schema不兼容
**风险**: atomic_generation.py 依赖的表结构可能不存在或字段缺失
**检查**:
- [ ] `annual_growth_plan` 表是否有 `source_assessment_id`, `planning_source_type` 字段
- [ ] `plan_item` 表是否有 `assessment_revision`, `planning_source_type` 字段
- [ ] `learning_task` 表是否有 `plan_item_id` 外键

**影响**: 如果字段不存在，atomic_generation 会抛出SQL错误
**缓解**: 先运行 schema check，如缺失则需要migration

### 2. 现有测试大量失败
**风险**: 移除Buddy门禁后，依赖旧行为的测试会失败
**预估影响**:
- `test_planning.py` 中的 gate 测试（预计5-10个）
- `test_assessment.py` 中检查"等待复核"的测试（预计3-5个）
- E2E测试中的断言（预计2-3个）

**影响**: 如果失败数量超过20个，修复时间可能超出预估
**缓解**: 先快速扫描测试文件，评估影响范围

### 3. Backend容器持续无法启动
**风险**: 当前backend重启循环，可能是代码bug而非临时问题
**症状**: 连接postgres socket失败
**可能原因**:
- DATABASE_URL配置错误
- 新代码import循环依赖
- migration runner失败

**影响**: 无法运行后端测试，无法部署容器
**缓解**: 在容器外运行pytest确认代码OK，定位容器配置问题

### 4. Frontend测试因API变更失败
**风险**: submit_assessment返回格式变化，frontend mock可能不匹配
**检查**:
- [ ] AssessmentGapPage.test.tsx 是否mock了 plan_generation 字段
- [ ] 其他调用 submitAssessment 的测试

**影响**: 前端测试失败，需要更新mock
**缓解**: 已检查，当前281个测试通过，但E2E未运行

---

## 🟡 中风险 - 可能延长时间

### 5. 文档更新范围不明确
**风险**: 01_Product.md 可能有多处提到Buddy复核流程
**预估**: 3份文档，每份可能5-10处修改
**影响**: 如果修改点超过30处，可能需要2-3小时而非1-2小时

### 6. E2E测试环境问题
**风险**: Playwright需要browser binary，可能缺失或版本不匹配
**影响**: E2E无法运行，需要时间排查环境
**缓解**: 先运行 `npm run test:e2e -- --list`，检查是否能启动

### 7. 幂等性边界情况
**风险**: 多次提交、并发提交、部分回滚场景未覆盖
**检查**:
- [ ] 如果 annual_plan 已存在但 plan_item 被删除？
- [ ] 如果 plan_item 存在但 learning_task 被删除？
- [ ] 如果两个请求同时提交同一个assessment？

**影响**: 需要额外的测试用例和边界处理
**缓解**: 先实现基本幂等，复杂场景标记为TODO

---

## 🟢 低风险 - 可控

### 8. Git冲突
**风险**: 如果master分支有新提交，merge时可能冲突
**缓解**: 已基于最新master，且修改文件独立

### 9. 文档格式问题
**风险**: Markdown格式错误、链接失效
**影响**: 文档review时需要修复
**缓解**: 使用简单格式，避免复杂table

### 10. 性能问题
**风险**: 原子生成可能导致提交变慢（生成N个任务）
**影响**: 用户体验下降，但不影响功能
**缓解**: 在测试中记录耗时，如果>2秒则优化

---

## 🔍 立即执行的检查清单

在继续前，必须确认：

### A. Schema验证 (5分钟)
```sql
-- 检查必需字段是否存在
SELECT column_name 
FROM information_schema.columns 
WHERE table_name IN ('annual_growth_plan', 'plan_item', 'learning_task')
ORDER BY table_name, column_name;
```

### B. 测试影响评估 (10分钟)
```bash
# 快速扫描依赖旧gate行为的测试
grep -r "等待.*复核\|Buddy.*复核\|认可" backend/tests --include="*.py" | wc -l
grep -r "check_annual_plan_gate" backend/tests --include="*.py" | wc -l
```

### C. 容器诊断 (5分钟)
```bash
# 在容器外验证代码可导入
cd backend && python3 -c "from app.planning.atomic_generation import generate_plan_and_tasks_from_assessment; print('OK')"

# 检查compose配置
grep -A5 "DATABASE_URL" compose.yaml
```

### D. Frontend Mock验证 (5分钟)
```bash
# 检查是否有mock submitAssessment的地方
grep -r "submitAssessment" frontend/src --include="*.test.tsx" | grep mock
```

---

## 🎯 静默执行决策点

如果以下任一条件成立，**必须中断并报告**：

1. ❌ Schema缺失超过2个关键字段 → 需要migration，预估+2小时
2. ❌ 测试失败超过30个 → 影响范围超出预期，需要重新评估
3. ❌ 容器问题在30分钟内无法定位 → 可能是架构问题，需要讨论
4. ❌ Frontend核心测试失败 → API contract变更影响大，需要review
5. ❌ 发现业务逻辑冲突 → 需要澄清需求

---

## ✅ 执行计划

**立即行动** (25分钟):
1. 运行上述A/B/C/D检查
2. 如果全部通过 → 继续静默执行
3. 如果任一失败 → 报告风险，等待决策

**预计静默时长**: 5-6小时  
**最坏情况**: 8小时（如遇中风险）  
**不可接受**: >10小时（超出明早deadline）

---

**现在开始风险检查**
