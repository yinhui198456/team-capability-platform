# Iteration 6A UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver UI-01 through UI-04 as a usable Member/Buddy workspace while preserving existing business rules and APIs.

**Architecture:** Add one Member-only read model for UI-01; keep existing feature endpoints and move presentation into a shared responsive workspace shell. UI-04 composes the existing assessment and Evidence review flows rather than creating a new review state machine.

**Tech Stack:** FastAPI, psycopg, PostgreSQL, React 18, TypeScript, Vitest, Testing Library, CSS, GitHub Project v2 CLI.

## Global Constraints

- Scope is 6A only: UI-01 to UI-04; do not start UI-05, Leader, Admin, or 6B work.
- 4-5 and 5-4 remain pending user UAT; the user explicitly authorized 6A to start before those confirmations.
- Use only the six enabled domains: `P01`, `P02`, `P03`, `C01`, `C02`, `C03`.
- Keep Member data self-scoped; keep Buddy data restricted to assigned members.
- Reuse existing React, Ant Design dependencies, and native SVG; add no dependency.
- Write a failing test before production code and commit each independently reviewable task.
- Update Git Project cards at each real state transition; do not mark a task Done before its tests and Codex review pass.

---

## File Structure

| Path | Responsibility |
|---|---|
| `backend/app/planning/repository.py` | Add the Member dashboard read model beside existing planning aggregations. |
| `backend/app/planning/api.py` | Expose one Member-only dashboard endpoint. |
| `backend/tests/test_member_dashboard.py` | API-level data-scope and aggregation tests. |
| `frontend/src/planning.ts` | Dashboard contract and `getMemberDashboard` fetch helper. |
| `frontend/src/MemberDashboardPage.tsx` | UI-01 cards, SVG radar, Gap domain filter, and task links. |
| `frontend/src/MemberDashboardPage.test.tsx` | UI-01 render, filter, and navigation tests. |
| `frontend/src/WorkspaceLayout.tsx` | Shared 6A top bar, role-aware sidebar, and route outlet. |
| `frontend/src/App.tsx` | Add `/dashboard/member`, compose 6A routes through the workspace shell. |
| `frontend/src/styles.css` | Shared 6A visual tokens, responsive layout, cards, tables, tags, and SVG styles. |
| `frontend/src/AssessmentPage.tsx`, `GapPage.tsx`, `AnnualPlanPage.tsx`, `LearningTaskPage.tsx`, `ProfilePage.tsx` | Preserve existing behavior while adding UI-02/UI-03 landmarks and visual classes. |
| `frontend/src/BuddyReviewCenter.tsx` | UI-04 member filter, review tabs, selected-item work area, and history. |
| `frontend/src/BuddyReviewCenter.test.tsx` | UI-04 assigned-member scope, queue tab, and feedback submission tests. |

## Task 1: Synchronize Iteration 6A Git Project State

**Files:**
- Modify remotely: GitHub Project `yinhui198456/1` Epic `PVTI_lAHOAZvqts4Bdb-fzgy3f-U`, 6A parent `PVTI_lAHOAZvqts4Bdb-fzgy4N40`, and 6A-1 `PVTI_lAHOAZvqts4Bdb-fzgy_JCE`.

**Interfaces:**
- Consumes: approved design at `docs/superpowers/specs/2026-07-16-6a-ui-integration-design.md`.
- Produces: accurate board state before production work begins.

- [ ] **Step 1: Write the three detailed card bodies to temporary files**

Create `/tmp/tcp-6a-epic.md`, `/tmp/tcp-6a-parent.md`, and `/tmp/tcp-6a-1.md`. The 6A-1 body must include the endpoint, Member-only scope, the six domains, the required aggregation fields, and the exact acceptance commands. The parent body must state `6A-1 → 6A-2 → 6A-3 → 6A-4`, UI-01–UI-04 scope, and that 6B remains blocked by 6A UAT.

- [ ] **Step 2: Update the three draft-issue bodies and set active status**

Run:

```bash
PROJECT_ID=PVT_kwHOAZvqts4Bdb-f
update_body() {
  gh api graphql \
    -f query='mutation($project:ID!, $draft:ID!, $body:String!) { updateProjectV2DraftIssue(input:{projectId:$project, draftIssueId:$draft, body:$body}) { projectItem { id } } }' \
    -F project="$PROJECT_ID" -F draft="$1" -F body="$(cat "$2")"
}
update_body DI_lAHOAZvqts4Bdb-fzgKxO3A /tmp/tcp-6a-epic.md
update_body DI_lAHOAZvqts4Bdb-fzgKxQ1k /tmp/tcp-6a-parent.md
update_body DI_lAHOAZvqts4Bdb-fzgKxj4g /tmp/tcp-6a-1.md
gh project item-edit --project-id "$PROJECT_ID" --id PVTI_lAHOAZvqts4Bdb-fzgy3f-U --field-id PVTSSF_lAHOAZvqts4Bdb-fzhX9hn4 --single-select-option-id 47fc9ee4
gh project item-edit --project-id "$PROJECT_ID" --id PVTI_lAHOAZvqts4Bdb-fzgy4N40 --field-id PVTSSF_lAHOAZvqts4Bdb-fzhX9hn4 --single-select-option-id 47fc9ee4
gh project item-edit --project-id "$PROJECT_ID" --id PVTI_lAHOAZvqts4Bdb-fzgy_JCE --field-id PVTSSF_lAHOAZvqts4Bdb-fzhX9hn4 --single-select-option-id 47fc9ee4
```

- [ ] **Step 3: Verify the board state**

Run:

```bash
gh project item-list 1 --owner yinhui198456 --format json --limit 100 \
  | jq -r '.items[] | select(.title | test("迭代 6|6A")) | [.title, .status, .content.body] | @json'
```

Expected: Epic, 6A, and 6A-1 are `In Progress`; 6A-2 through 6A-4 remain `Todo`; bodies describe their actual scope and acceptance.

- [ ] **Step 4: Commit**

No repository commit: this task changes only Git Project state.

## Task 2: Add the UI-01 Member Dashboard Read Model

**Files:**
- Modify: `backend/app/planning/repository.py`, `backend/app/planning/api.py`.
- Create: `backend/tests/test_member_dashboard.py`.

**Interfaces:**
- Produces `get_member_dashboard(connection, member_id, year) -> dict[str, object]`.
- Produces `GET /api/planning/member-dashboard?year=2026`, restricted by `_require_member` and bound to `user["id"]`.

- [ ] **Step 1: Write failing API tests**

In `backend/tests/test_member_dashboard.py`, use the existing ASGI login helpers and seed two Members. Assert the logged-in Member receives only their plan/task/log/Evidence rows and all six fixed domain codes:

```python
def test_member_dashboard_aggregates_only_current_member_data(connection):
    member_cookies = _login(connection, "member")
    status, body, _ = _request(
        "GET", "/api/planning/member-dashboard?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert body["year"] == 2026
    assert [domain["code"] for domain in body["domains"]] == [
        "P01", "P02", "P03", "C01", "C02", "C03"
    ]
    assert all(task["member_id"] == 1 for task in body["current_tasks"])


def test_member_dashboard_rejects_non_member(connection):
    buddy_cookies = _login(connection, "buddy")
    status, body, _ = _request(
        "GET", "/api/planning/member-dashboard?year=2026", cookies=buddy_cookies
    )
    assert status == 403
    assert body["detail"] == "insufficient permissions"
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/workspace/capability-model:ro" backend sh -c \
  'pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_member_dashboard.py'
```

Expected: FAIL because `/api/planning/member-dashboard` does not exist.

- [ ] **Step 3: Implement the smallest read model and endpoint**

Add `get_member_dashboard` to `repository.py`. It must produce this stable shape:

```python
{
    "year": year,
    "plan": {"total": 0, "completed": 0, "in_progress": 0, "not_started": 0, "overdue": 0},
    "hours": {"year_actual": 0, "year_planned": 0, "month_actual": 0, "month_planned": 0},
    "todos": {"evidence_draft": 0, "buddy_review": 0, "plan_due": 0, "task_overdue": 0},
    "domains": [{"code": "P01", "current_level": 0.0, "target_level": 0.0}],
    "gaps": [{"domain_code": "P01", "l3_code": "P01-...", "current_level": 0, "target_level": 0, "gap_value": 0, "priority": "高"}],
    "current_tasks": [{"id": 1, "member_id": 1, "l3_code": "P01-...", "status": "进行中", "target_month": 1, "estimated_hours": 0, "actual_hours": 0}],
}
```

Use `COALESCE`, `COUNT`, and the existing annual-plan ownership joins. Calculate the current month with `CURRENT_DATE`; do not create dashboard tables or persist snapshots. Register the endpoint in `api.py` with `_require_member(user)` and `int(user["id"])`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS.

- [ ] **Step 5: Run planning regressions and commit**

Run:

```bash
docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/workspace/capability-model:ro" backend sh -c \
  'pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && PYTHONPATH=/workspace/backend pytest -q tests/test_progress_log.py tests/test_capability_profile.py tests/test_member_dashboard.py'
git add backend/app/planning/api.py backend/app/planning/repository.py backend/tests/test_member_dashboard.py
git commit -m "feat: add member dashboard aggregation"
```

Expected: all selected tests PASS.

## Task 3: Build the UI-01 Dashboard and Shared 6A Shell

**Files:**
- Create: `frontend/src/MemberDashboardPage.tsx`, `frontend/src/MemberDashboardPage.test.tsx`, `frontend/src/WorkspaceLayout.tsx`.
- Modify: `frontend/src/planning.ts`, `frontend/src/App.tsx`, `frontend/src/styles.css`.

**Interfaces:**
- Consumes: `GET /api/planning/member-dashboard?year=2026`.
- Produces: `MemberDashboardPage` at `/dashboard/member` and `WorkspaceLayout` for 6A routes.

- [ ] **Step 1: Write failing dashboard tests**

Add a mocked `getMemberDashboard` test that renders `/dashboard/member`, selects `P01`, and asserts only the `P01` Gap row remains:

```tsx
it('filters dashboard gaps by enabled domain', async () => {
  window.history.pushState({}, '', '/dashboard/member')
  render(<App />)
  await screen.findByText('我的成长看板')
  fireEvent.click(screen.getByRole('button', { name: 'P01 Data Infra' }))
  expect(screen.getByText('P01-L2A-L3A')).toBeTruthy()
  expect(screen.queryByText('P02-L2A-L3A')).toBeNull()
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run test -- MemberDashboardPage.test.tsx
```

Expected: FAIL because the page and fetch helper do not exist.

- [ ] **Step 3: Add the contract, SVG radar, and shell**

Add a `MemberDashboard` type and `getMemberDashboard(year: number)` in `planning.ts`. Render KPI cards, task table, domain buttons, filtered Gap rows, and a six-axis native `<svg aria-label="个人能力雷达图">`. `WorkspaceLayout` must render top navigation, Member/Buddy sidebar links, and `children`; `App.tsx` must route `/dashboard/member` and wrap all UI-01–UI-04 routes, without changing the existing page fetch functions.

- [ ] **Step 4: Add minimal visual CSS**

Append 6A-scoped styles for `.workspace`, `.workspace-header`, `.workspace-sidebar`, `.workspace-content`, `.metric-card`, `.status-tag`, `.data-table`, and `.radar-chart`. Use the existing blue/gray/white palette and a one-column layout below `900px`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm run test -- MemberDashboardPage.test.tsx ProfilePage.test.tsx
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/MemberDashboardPage.tsx frontend/src/MemberDashboardPage.test.tsx frontend/src/WorkspaceLayout.tsx frontend/src/planning.ts frontend/src/App.tsx frontend/src/styles.css
git commit -m "feat: add member dashboard workspace"
```

## Task 4: Integrate UI-02 and UI-03 Without Changing Their Workflows

**Files:**
- Modify: `frontend/src/AssessmentPage.tsx`, `frontend/src/GapPage.tsx`, `frontend/src/AnnualPlanPage.tsx`, `frontend/src/LearningTaskPage.tsx`, `frontend/src/ProfilePage.tsx`, `frontend/src/styles.css`.
- Test: `frontend/src/assessment.test.tsx`, `frontend/src/GapPage.test.tsx`, `frontend/src/AnnualPlanPage.test.tsx`, `frontend/src/LearningTaskPage.test.tsx`, `frontend/src/ProfilePage.test.tsx`.

**Interfaces:**
- Consumes: existing assessment and planning helpers unchanged.
- Produces: prototype-aligned landmarks and stable interactions for UI-02 and UI-03.

- [ ] **Step 1: Write failing layout/behavior regression tests**

Add one assertion per existing page for the new landmark, while retaining an existing business assertion:

```tsx
expect(screen.getByRole('region', { name: 'Gap 概览' })).toBeTruthy()
expect(screen.getByText(/存在待复核的自评/)).toBeTruthy()
```

For UI-03, assert the annual-plan summary and Evidence version region remain visible after selecting a task:

```tsx
expect(screen.getByRole('region', { name: '年度计划总览' })).toBeTruthy()
expect(screen.getByRole('region', { name: 'Evidence 版本' })).toBeTruthy()
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm run test -- assessment.test.tsx GapPage.test.tsx AnnualPlanPage.test.tsx LearningTaskPage.test.tsx
```

Expected: FAIL because the named UI-02/UI-03 regions are not present.

- [ ] **Step 3: Add semantic regions and visual classes only**

Use `<section aria-label="...">` wrappers and CSS classes to form the UI-02 assessment table/Gap sidebar and UI-03 annual-summary/timeline/task-detail/Evidence regions. Do not alter request helpers, state transition code, form submission payloads, or role checks.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS, including existing gate and Evidence behavior.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/AssessmentPage.tsx frontend/src/GapPage.tsx frontend/src/AnnualPlanPage.tsx frontend/src/LearningTaskPage.tsx frontend/src/ProfilePage.tsx frontend/src/styles.css frontend/src/assessment.test.tsx frontend/src/GapPage.test.tsx frontend/src/AnnualPlanPage.test.tsx frontend/src/LearningTaskPage.test.tsx
git commit -m "feat: align member pages with UI prototypes"
```

## Task 5: Compose the UI-04 Buddy Review Center

**Files:**
- Create: `frontend/src/BuddyReviewCenter.tsx`, `frontend/src/BuddyReviewCenter.test.tsx`.
- Modify: `frontend/src/App.tsx`, `frontend/src/styles.css`.

**Interfaces:**
- Consumes: `listPendingReviews`, `getAssessment`, `submitReview`, `listPendingEvidenceReviews`, and `submitEvidenceReview`.
- Produces: `/mentoring/dashboard` with `全部待复核`, `自评复核`, and `Evidence Review` tabs.

- [ ] **Step 1: Write a failing assigned-member and tab test**

Mock one assessment review and one Evidence review for different members. Assert switching to `Evidence Review` hides the assessment queue, and selecting the Evidence item passes its existing id to the submit helper:

```tsx
fireEvent.click(screen.getByRole('tab', { name: 'Evidence Review' }))
expect(screen.getByText(/member-b · P02/)).toBeTruthy()
expect(screen.queryByText(/成员 1 · 2026/)).toBeNull()
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm run test -- BuddyReviewCenter.test.tsx
```

Expected: FAIL because `/mentoring/dashboard` has no component.

- [ ] **Step 3: Implement the smallest center**

Render member filters from the union of returned review `member_id` values; default to `全部成员`. Filter local queues by selected member and tab. Reuse the existing conclusion values exactly, display the selected evidence or assessment details, and submit through the existing helpers. Do not request or display non-pending cross-member history.

- [ ] **Step 4: Route and style the center**

Add `/mentoring/dashboard` to `App.tsx`, the workspace sidebar, and styles for `.review-tabs`, `.review-queue`, `.review-workspace`, and `.review-history`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm run test -- BuddyReviewCenter.test.tsx AssessmentReviewPage.test.tsx EvidenceReviewPage.test.tsx
```

Expected: PASS; existing separate routes remain usable.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/BuddyReviewCenter.tsx frontend/src/BuddyReviewCenter.test.tsx frontend/src/App.tsx frontend/src/styles.css
git commit -m "feat: add buddy review center"
```

## Task 6: Verify 6A and Transition Git Project Cards

**Files:**
- Modify remotely: 6A-1, 6A-2, 6A-3, and 6A-4 DraftIssue bodies and Project fields.

**Interfaces:**
- Consumes: commits from Tasks 2–5 and their test evidence.
- Produces: 6A implementation cards marked Done only after verification; a detailed UAT card marked `In Progress / 待用户确认 / 用户`.

- [ ] **Step 1: Run the full verification suite**

Run:

```bash
docker compose run --rm -v "$PWD/backend:/workspace/backend:ro" -v "$PWD/capability-model:/workspace/capability-model:ro" backend sh -c \
  'pip install -q -r /workspace/backend/requirements-dev.txt && cd /workspace/backend && ruff check . && black --check . && PYTHONPATH=/workspace/backend pytest -q tests/'
cd frontend && npm run test && npm run lint && npm run build && npm run format:check
cd .. && git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Capture the 6A UAT checklist**

Write `/tmp/tcp-6a-4.md` with these user checks:

```markdown
### UI-01 我的成长看板
- [ ] member 登录后可打开 `/dashboard/member`，四项时长、计划状态、待办、六域 Gap 和当前任务均可见。
- [ ] 选择一个能力域后，仅显示该域 Gap；点击任务或待办进入对应页面。

### UI-02 / UI-03 Member 工作台
- [ ] 自评、Gap、计划门禁、计划项、日志和 Evidence 版本的现有操作仍可完成。
- [ ] UI-02/03 的表格、摘要、状态和详情区与固定原型的信息层级一致。

### UI-04 Buddy 复核中心
- [ ] buddy 仅看到负责成员；成员筛选与自评/Evidence 队列 Tab 联动。
- [ ] 提交“认可/建议调整”或“通过/需补充/驳回”后，项目从待办队列消失且反馈可见。
```

- [ ] **Step 3: Update detailed bodies and field values**

Use the Task 1 GraphQL mutation for 6A-1 (`DI_lAHOAZvqts4Bdb-fzgKxj4g`), 6A-2 (`DI_lAHOAZvqts4Bdb-fzgKxj4k`), 6A-3 (`DI_lAHOAZvqts4Bdb-fzgKxj40`), and 6A-4 (`DI_lAHOAZvqts4Bdb-fzgKxj4w`). Set 6A-1–6A-3 to `Done / 已完成`; set 6A-4 to `In Progress / 待用户确认 / 用户` with `/tmp/tcp-6a-4.md` as its body.

Run:

```bash
PROJECT_ID=PVT_kwHOAZvqts4Bdb-f
gh project item-edit --project-id "$PROJECT_ID" --id PVTI_lAHOAZvqts4Bdb-fzgy_JCE --field-id PVTSSF_lAHOAZvqts4Bdb-fzhX9hn4 --single-select-option-id 98236657
gh project item-edit --project-id "$PROJECT_ID" --id PVTI_lAHOAZvqts4Bdb-fzgy_JCI --field-id PVTSSF_lAHOAZvqts4Bdb-fzhX9hn4 --single-select-option-id 98236657
gh project item-edit --project-id "$PROJECT_ID" --id PVTI_lAHOAZvqts4Bdb-fzgy_JFI --field-id PVTSSF_lAHOAZvqts4Bdb-fzhX9hn4 --single-select-option-id 98236657
gh project item-edit --project-id "$PROJECT_ID" --id PVTI_lAHOAZvqts4Bdb-fzgy_JFE --field-id PVTSSF_lAHOAZvqts4Bdb-fzhX9hn4 --single-select-option-id 47fc9ee4
```

- [ ] **Step 4: Verify final board state and commit any verification-only repository artifacts**

Run the Task 1 verification command. Expected: 6A-1–6A-3 are Done, 6A-4 is In Progress and assigned to the user, 6B remains Todo. Do not change 4-5 or 5-4.

No repository commit is needed unless this task creates a checked-in acceptance artifact.

## Plan Self-Review

- Spec coverage: Tasks 2–5 cover the UI-01 endpoint, shared shell, UI-02/UI-03, UI-04, six-domain restriction, Member/Buddy scope, and no-new-dependency rule. Task 6 covers verification and the required detailed UAT card.
- Placeholder scan: no deferred implementation placeholders; every task includes files, interfaces, RED/GREEN commands, and commit boundaries.
- Type consistency: `get_member_dashboard` produces the response fetched by `getMemberDashboard`; the endpoint name and dashboard path remain identical across Tasks 2 and 3.
