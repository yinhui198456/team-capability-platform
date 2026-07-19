# Task Plan: TCP Frontend Rescue

## R0 ✅ 完成 | R1 进行中 (92/106 tests)

### R1.1 React Router ✅
- [x] react-router-dom installed
- [x] BrowserRouter in main.tsx
- [x] App.tsx → pure Routes (78 lines, down from 948)
- [x] Layout.tsx with new Member IA sidebar
- [x] Legacy redirects via Navigate
- [x] 4 dead routes cleaned

### R1.2 Shared HTTP Client ✅
- [x] shared/api.ts — unified request<T> + getOrNull<T>
- [x] 7 files migrated (planning, assessment, access, catalog, gap, assessmentReview, system)
- [x] createLearningTask() added to planning.ts

### R1.3 CSS Token + Modules
- [x] styles/tokens.css — CSS variables (colors, typography, spacing, borders, shadows)
- [x] styles/global.css — reset + app shell + shared components
- [ ] Page components → *.module.css (R2)

### R1.4 Extract Inline Pages ✅
- [x] CapabilityModelPage.tsx extracted
- [x] LearningResourcesPage.tsx extracted
- [x] App.tsx 948→78 lines

### R1.5 Member New IA Sidebar ✅
- [x] 5 modules: 工作台/能力成长/我的计划/成长记录/能力标准
- [x] No ①②③ numbering
- [x] NavLink active highlighting
- [x] scopeLabel preserved

### R1.6 Cleanup
- [x] Dead routes → Navigate redirects
- [ ] Zombie CSS cleanup (R2)
- [ ] Dynamic year context (pending)

### R1.7 Monthly Review Skeleton
- [ ] Page entry + skeleton (pending)

## Test Status
- 92 passed / 14 failed (sub-agent fixing)
