---
title: Pre-E2E Test Environment Check
description: Comprehensive environment validation before running E2E tests
tags: [testing, e2e, validation, environment]
---

# Pre-E2E Test Environment Check

## Purpose
Catch environment configuration issues before running time-consuming E2E tests.

## When to Use
- Before running full E2E test suite
- After environment changes (env vars, Docker restart, database seed)
- Before CI/CD pipeline execution
- After pulling code changes that affect configuration

## Checklist

### 1. Environment Variables Validation
```bash
# Extract required env vars from test code
echo "Required environment variables:"
grep -r "process.env" frontend/tests/e2e --include="*.ts" | \
  grep -o "process.env\.[A-Z_]*" | sort -u

# Check if set
env | grep -E "TCP_E2E|DEMO"
```

**Action**: Set missing variables before proceeding.

### 2. Backend Health Check
```bash
# Verify Backend is running and healthy
curl -f http://localhost:8000/health || echo "❌ Backend not healthy"

# Check Backend logs for errors
docker compose logs backend --tail=50 | grep -i "error\|exception\|failed"
```

**Action**: Fix Backend errors before testing.

### 3. Database Seed Validation
```bash
# Verify demo users exist
docker compose exec -T postgres psql -U postgres -d tcp_dev << 'SQL'
SELECT username, full_name, id 
FROM tcp_user 
WHERE username IN ('admin', 'member', 'buddy', 'leader')
ORDER BY username;
SQL
```

**Expected**: 4 users returned.  
**Action**: Re-run seed if missing.

### 4. Frontend Build Check
```bash
# Verify frontend is built and serving
curl -f http://localhost:3000 || echo "❌ Frontend not accessible"

# Check for build errors
cd frontend && npm run build --if-present
```

### 5. Port Availability
```bash
# Check critical ports are not blocked
for port in 3000 8000 5432; do
  nc -z localhost $port && echo "✅ Port $port available" || echo "❌ Port $port blocked"
done
```

### 6. Database Connection Pool
```bash
# Check database has capacity for concurrent connections
docker compose exec -T postgres psql -U postgres -d tcp_dev << 'SQL'
SELECT count(*) as current_connections, 
       current_setting('max_connections') as max_connections
FROM pg_stat_activity;
SQL
```

**Action**: If current > 80% of max, restart services.

## Pre-Test Summary Report
```bash
#!/bin/bash
echo "╔═══════════════════════════════════════════════╗"
echo "║  E2E Environment Validation Report            ║"
echo "╚═══════════════════════════════════════════════╝"

# Backend
curl -sf http://localhost:8000/health >/dev/null && echo "✅ Backend: Healthy" || echo "❌ Backend: Down"

# Frontend
curl -sf http://localhost:3000 >/dev/null && echo "✅ Frontend: Serving" || echo "❌ Frontend: Down"

# Database
docker compose exec -T postgres psql -U postgres -d tcp_dev -c "SELECT 1" >/dev/null 2>&1 && \
  echo "✅ Database: Connected" || echo "❌ Database: Unreachable"

# Demo Users
user_count=$(docker compose exec -T postgres psql -U postgres -d tcp_dev -t -c \
  "SELECT COUNT(*) FROM tcp_user WHERE username IN ('admin','member','buddy','leader')" 2>/dev/null | tr -d ' ')
[ "$user_count" = "4" ] && echo "✅ Demo Users: $user_count/4" || echo "❌ Demo Users: $user_count/4"

# Env Vars
[ -n "$TCP_E2E_DEMO_PASSWORD" ] && echo "✅ Env: TCP_E2E_DEMO_PASSWORD set" || echo "❌ Env: Missing password"

echo "═══════════════════════════════════════════════"
```

## Common Issues & Solutions

### Issue: Demo users missing
**Symptom**: 115/266 tests timeout at login  
**Solution**:
```bash
cd backend
docker compose exec backend python -m app.access.seed
```

### Issue: Environment variable not loaded
**Symptom**: Tests fail with "undefined" errors  
**Solution**:
```bash
export TCP_E2E_DEMO_PASSWORD="your_password"
# OR restart with docker compose up --force-recreate
```

### Issue: Database connection pool exhausted
**Symptom**: "too many clients" errors  
**Solution**:
```bash
docker compose restart postgres backend
```

## Success Criteria
All checks pass ✅ → Proceed with E2E tests  
Any check fails ❌ → Fix issue, re-validate, then test

## Time Savings
- Without validation: 45min test run + 30min debug = 75min
- With validation: 2min check + 45min test = 47min
- **Net savings: 28 minutes per test run**

## Integration with CI/CD
Add to `.github/workflows/e2e.yml`:
```yaml
- name: Validate E2E Environment
  run: |
    bash .claude/skills/pre-test-check.sh
    if [ $? -ne 0 ]; then
      echo "Environment validation failed"
      exit 1
    fi
```
