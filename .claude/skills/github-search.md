---
title: GitHub Experience Search
description: Search GitHub for similar implementations and best practices before starting new features
tags: [github, research, best-practices]
---

# GitHub Experience Search

## Purpose
Avoid reinventing the wheel by finding existing implementations, patterns, and common pitfalls on GitHub.

## When to Use
- Starting a new feature
- Encountering an unfamiliar problem
- Designing a new architecture
- Looking for testing patterns
- Before writing >100 lines of new code

## Search Templates

### 1. Similar Implementation Search
```bash
# Find similar feature implementations
gh search repos "<feature_name> <language>" \
  --language=<lang> \
  --stars=">100" \
  --sort=stars

# Example: Atomic transaction generation
gh search repos "atomic transaction generation python" \
  --language=python \
  --stars=">100"
```

### 2. Code Pattern Search
```bash
# Search for specific code patterns
gh search code "<pattern>" \
  --language=<lang> \
  --filename=<file>

# Example: FastAPI transaction management
gh search code "with connection.begin() fastapi" \
  --language=python
```

### 3. Issue/Problem Search
```bash
# Find similar issues and solutions
gh search issues "<error_message>" \
  --state=closed \
  --label=bug

# Example: Schema-related errors
gh search issues "column does not exist postgres" \
  --language=python \
  --state=closed
```

### 4. Best Practices Search
```bash
# Find comprehensive best practices repos
gh search repos "<technology> best practices" \
  --stars=">500" \
  --sort=stars

# Example: FastAPI best practices
gh search repos "fastapi best practices" \
  --stars=">500"
```

### 5. Testing Pattern Search
```bash
# Find testing approaches
gh search repos "<framework> testing examples" \
  --language=<lang> \
  --stars=">200"

# Example: Playwright E2E testing
gh search repos "playwright e2e testing" \
  --language=typescript \
  --stars=">200"
```

### 6. Common Pitfall Search
```bash
# Search for known issues/gotchas
gh search issues "<technology> gotcha OR pitfall OR trap" \
  repo:<popular_repo>

# Example: SQLAlchemy pitfalls
gh search issues "sqlalchemy gotcha OR pitfall" \
  --comments=">5"
```

## Pre-Development Checklist

Before starting a new feature, search for:

1. ✅ **Similar implementations** (5-10 repos)
2. ✅ **Common pitfalls** (closed issues)
3. ✅ **Best practices** (high-star repos)
4. ✅ **Testing patterns** (test suites)
5. ✅ **Documentation** (READMEs, wikis)

## Search Workflow

```bash
# 1. Define what you're building
FEATURE="atomic plan generation"
TECH_STACK="python fastapi postgres"

# 2. Search for implementations
gh search repos "$FEATURE $TECH_STACK" --stars=">50" | head -5

# 3. Search for code patterns
gh search code "$FEATURE" --language=python | head -10

# 4. Search for known issues
gh search issues "$FEATURE error OR problem" --state=closed | head -5

# 5. Save findings to review
```

## Documentation Review

After finding relevant repos, check:
- README.md - Overview and quick start
- docs/ - Detailed documentation
- tests/ - Testing approach
- CONTRIBUTING.md - Development practices
- Issues (closed) - Known problems and solutions

## Real-World Example: Issue #82

**What we should have searched**:

1. **Atomic transaction pattern**
   ```bash
   gh search code "with connection.begin() INSERT" --language=python
   ```
   → Would find SQLAlchemy transaction patterns

2. **Schema validation before queries**
   ```bash
   gh search repos "database schema validation python"
   ```
   → Would find tools like Pydantic, SQLAlchemy Inspector

3. **E2E test environment setup**
   ```bash
   gh search repos "playwright test environment setup" --language=typescript
   ```
   → Would find pre-test validation patterns

4. **Common PostgreSQL pitfalls**
   ```bash
   gh search issues "column does not exist postgres" --state=closed
   ```
   → Would find similar schema assumption errors

**Time saved**: ~1 hour of debugging

## Integration with Development Workflow

### Pre-commit Hook
```bash
# .git/hooks/pre-commit
if git diff --cached --name-only | grep -q "backend/app/.*\.py"; then
  echo "💡 Tip: Search GitHub for similar implementations:"
  echo "   gh search repos '<your-feature> python fastapi'"
fi
```

### Project Onboarding
Add to `docs/05_Development.md`:
```markdown
Before starting any feature:
1. Run GitHub experience search
2. Review top 3 similar implementations
3. Note common pitfalls
4. Adapt patterns to our project
```

## Quality Metrics

Good search results should have:
- ⭐ Stars: >100 (popular)
- 🔄 Updated: Last 6 months (maintained)
- 📝 Documentation: Comprehensive README
- ✅ Tests: >70% coverage
- 🐛 Issues: Active discussion, closed bugs

## Common Search Queries

### FastAPI
```bash
gh search repos "fastapi transaction management" --stars=">100"
gh search repos "fastapi testing best practices" --stars=">200"
gh search code "fastapi connection pool" --language=python
```

### PostgreSQL
```bash
gh search repos "postgres schema migration" --stars=">500"
gh search issues "postgres connection pool exhausted" --state=closed
```

### Playwright
```bash
gh search repos "playwright test patterns" --language=typescript --stars=">100"
gh search code "playwright environment setup" --language=typescript
```

### Python Testing
```bash
gh search repos "python pytest patterns" --stars=">200"
gh search code "pytest fixture database" --language=python
```

## Time Investment vs. Savings

- **Search time**: 10-15 minutes
- **Typical savings**: 1-2 hours of debugging
- **ROI**: 4-8x return on time invested

## When NOT to Search

- Trivial changes (<20 lines)
- Well-known patterns you've used before
- Project-specific business logic
- Urgent hotfixes (search after fixing)

## Success Stories

Using this skill could have prevented:
- Issue #82: Schema assumption error (saved ~1h)
- Issue #82: E2E environment issues (saved ~30min)
- Issue #82: Transaction pattern discovery (saved ~20min)

**Total potential savings: ~1.5 hours per feature**
