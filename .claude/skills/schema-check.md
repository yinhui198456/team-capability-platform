---
title: Schema-First Development Check
description: Pre-development checklist for database schema validation
tags: [database, development, checklist]
---

# Schema-First Development Check

## Purpose
Prevent schema assumption errors by validating table structure before writing code.

## When to Use
- Adding new database queries
- Using unfamiliar table fields
- Implementing cross-table joins
- Working with foreign key relationships

## Checklist

### 1. Read Schema Definition
```bash
# Find relevant schema file
find backend/app -name "schema.py" | grep <module>

# Read the schema
Read backend/app/<module>/schema.py
```

### 2. Check Existing Usage Patterns
```bash
# Find similar queries in repository.py
grep -n "<table_name>" backend/app/<module>/repository.py
```

### 3. Verify Field Existence
- ✅ Check field name spelling
- ✅ Check field type (int, str, bool, etc.)
- ✅ Check nullable constraints
- ✅ Check default values
- ✅ Check foreign key relationships

### 4. Write Unit Test First
```python
def test_<feature>_query():
    # Test the SQL query in isolation
    result = execute_query(connection, params)
    assert result is not None
    assert "expected_field" in result
```

### 5. Run Integration Test
Only after unit test passes.

## Anti-Patterns to Avoid
❌ Assuming field location based on name  
❌ Relying on memory from other projects  
❌ Writing code before reading schema  
❌ Guessing field types  
❌ Running full integration test first  

## Success Metrics
- Zero "column does not exist" errors
- Zero "relation does not exist" errors
- Reduced debug cycles (target: 1-2 iterations max)

## Example: Issue #82
**Wrong Approach** (3 failed attempts):
```python
# Assumed planning_snapshot_id in assessment_detail
snapshot_id = detail.get("planning_snapshot_id")  # ❌ Wrong table
```

**Correct Approach**:
1. Read `schema.py` → Found `capability_standard_planning_snapshot` table
2. Checked `repository.py` → Found `_planning_snapshot_for()` pattern
3. Wrote query:
```python
snapshot = connection.execute(
    "SELECT id FROM capability_standard_planning_snapshot WHERE ..."
).fetchone()
```

## Time Savings
- Without checklist: ~1 hour of debugging
- With checklist: ~15 minutes of upfront validation
- **Net savings: 45 minutes per feature**
