# 🚨 关键风险发现

## 约束冲突 - 必须立即修复

### 问题
`annual_growth_plan` 和 `plan_item` 表有约束：
```sql
CHECK (planning_source_type IS NULL OR planning_source_type = 'assessment_approval'::text)
```

但 `atomic_generation.py` 尝试使用：
```python
planning_source_type='atomic_v0015'
```

**这会导致 INSERT 失败！**

### 修复方案

**选项1**: 使用允许的值
- 改为 `planning_source_type='assessment_approval'`
- 符合现有约束
- 最快速

**选项2**: 修改约束（需要migration）
- 添加新值 `'atomic_v0015'`
- 需要写migration脚本
- 需要更多时间（+1-2小时）

### 决策
**立即采用选项1**，使用 `'assessment_approval'` 保持兼容性

---

## 其他风险状态

✅ **低风险**:
- 代码可导入
- Schema字段存在
- Frontend不会冲突

⚠️  **中风险**:
- 43处测试提到"复核/认可"需要检查
- 预计需要修改10-20个测试

---

## 立即行动
修复 atomic_generation.py 中的 planning_source_type 值
