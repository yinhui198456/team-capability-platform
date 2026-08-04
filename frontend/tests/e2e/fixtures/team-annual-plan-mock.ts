import type { Page } from '@playwright/test'

// Static, deterministic data for the Team Annual Plan read-only list.

const allItems = [
  {
    id: 101,
    annual_growth_plan_id: 11,
    growth_goal_id: 21,
    member_id: 3,
    username: 'member',
    full_name: '张三',
    l1_code: 'P01',
    l1_name: 'Data Infra',
    l2_code: 'P01-L2A',
    l2_name: '数据建模标准',
    l3_code: 'P01-L2A-L3A',
    l3_name: '数据建模与治理',
    current_level: 2,
    target_level: 4,
    priority: '高',
    status: '进行中',
    plan_quarter: 'Q1',
    plan_month: 2,
    estimated_hours: '16',
    learning_material: null,
    learning_task_content: null,
    expected_output: null,
    plan_start_date: '2026-02-01',
    plan_end_date: '2026-02-28',
    target_month: 2,
    revision: 1,
  },
  {
    id: 102,
    annual_growth_plan_id: 11,
    growth_goal_id: 22,
    member_id: 3,
    username: 'member',
    full_name: '张三',
    l1_code: 'P02',
    l1_name: 'AI Infra / Agent',
    l2_code: 'P02-L1B',
    l2_name: 'ML Pipeline 标准',
    l3_code: 'P02-L1B-L2A',
    l3_name: 'ML Pipeline 搭建',
    current_level: 1,
    target_level: 3,
    priority: '中',
    status: '未开始',
    plan_quarter: 'Q1',
    plan_month: 3,
    estimated_hours: '24',
    learning_material: null,
    learning_task_content: null,
    expected_output: null,
    plan_start_date: '2026-03-01',
    plan_end_date: '2026-03-31',
    target_month: 3,
    revision: 1,
  },
  {
    id: 103,
    annual_growth_plan_id: 12,
    growth_goal_id: 23,
    member_id: 5,
    username: 'member2',
    full_name: '李四',
    l1_code: 'C03',
    l1_name: '学习创新',
    l2_code: 'C03-L2A',
    l2_name: '创新实践标准',
    l3_code: 'C03-L2A-L3A',
    l3_name: '技术创新提案',
    current_level: 2,
    target_level: 3,
    priority: '低',
    status: '已完成',
    plan_quarter: 'Q2',
    plan_month: 5,
    estimated_hours: '8',
    learning_material: null,
    learning_task_content: null,
    expected_output: null,
    plan_start_date: '2026-05-01',
    plan_end_date: '2026-05-31',
    target_month: 5,
    revision: 1,
  },
]

const publishedPlan = {
  id: 1,
  code: 'TACP-2026',
  year: 2026,
  publisher_id: 1,
  resource_arrangement: 'Q1 bootcamp + monthly sharing',
  description: 'Team focus for the year',
  published_at: '2026-01-01T00:00:00Z',
  status: '已发布',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  focus_domains: ['P01', 'P02'],
}

function matchesFilters(
  item: (typeof allItems)[number],
  filters: {
    domain_code: string | null
    priority: string | null
    status: string | null
    quarter: string | null
    month: number | null
    member_id: number | null
    q: string | null
  },
) {
  if (filters.domain_code && !item.l3_code.startsWith(filters.domain_code)) {
    return false
  }
  if (filters.priority && item.priority !== filters.priority) return false
  if (filters.status && item.status !== filters.status) return false
  if (filters.quarter && item.plan_quarter !== filters.quarter) return false
  if (filters.month !== null && item.plan_month !== filters.month) return false
  if (filters.member_id !== null && item.member_id !== filters.member_id) {
    return false
  }
  if (filters.q) {
    const term = filters.q.toLowerCase()
    const text =
      `${item.full_name} ${item.l3_code} ${item.l3_name} ${item.l2_name}`.toLowerCase()
    if (!text.includes(term)) return false
  }
  return true
}

function applySorting(
  items: typeof allItems,
  sortBy: string,
  sortOrder: 'asc' | 'desc',
) {
  const direction = sortOrder === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    let comparison = 0
    if (sortBy === 'plan_month') {
      comparison = (a.plan_month ?? 0) - (b.plan_month ?? 0)
    } else if (sortBy === 'priority') {
      const order = { 高: 3, 中: 2, 低: 1 }
      comparison =
        (order[a.priority as keyof typeof order] ?? 0) -
        (order[b.priority as keyof typeof order] ?? 0)
    } else if (sortBy === 'status') {
      comparison = a.status.localeCompare(b.status)
    } else if (sortBy === 'l3_code') {
      comparison = a.l3_code.localeCompare(b.l3_code)
    } else if (sortBy === 'member_id') {
      comparison = a.member_id - b.member_id
    }
    return comparison * direction
  })
}

export async function mockTeamAnnualPlanData(page: Page): Promise<void> {
  await page.route(/api\/planning\/team-annual-plan.*/, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (
      path === '/api/planning/team-annual-plan' &&
      request.method() === 'GET'
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(publishedPlan),
      })
    }

    if (
      path === '/api/planning/team-annual-plan/items' &&
      request.method() === 'GET'
    ) {
      const year = Number(url.searchParams.get('year') ?? 2026)
      const pageNumber = Math.max(1, Number(url.searchParams.get('page') ?? 1))
      const pageSize = Math.max(
        1,
        Math.min(100, Number(url.searchParams.get('page_size') ?? 20)),
      )
      const sortBy = url.searchParams.get('sort_by') || 'plan_month'
      const sortOrder =
        url.searchParams.get('sort_order') === 'desc' ? 'desc' : 'asc'

      const filters = {
        domain_code: url.searchParams.get('domain_code') || null,
        priority: url.searchParams.get('priority') || null,
        status: url.searchParams.get('status') || null,
        quarter: url.searchParams.get('quarter') || null,
        month: url.searchParams.get('month')
          ? Number(url.searchParams.get('month'))
          : null,
        member_id: url.searchParams.get('member_id')
          ? Number(url.searchParams.get('member_id'))
          : null,
        q: url.searchParams.get('q') || null,
      }

      const filtered = allItems.filter((item) => matchesFilters(item, filters))
      const sorted = applySorting(filtered, sortBy, sortOrder)
      const totalCount = sorted.length
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
      const start = (pageNumber - 1) * pageSize
      const paginated = sorted.slice(start, start + pageSize)

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          meta: {
            year,
            as_of: '2026-08-04T00:00:00.000Z',
            scope: 'leader_team',
            source: 'team_annual_plan.items.v1',
          },
          filters,
          pagination: {
            page: pageNumber,
            page_size: pageSize,
            total_pages: totalPages,
            total_count: totalCount,
          },
          items: paginated,
        }),
      })
    }

    if (path === '/api/planning/change-proposals') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    }

    return route.continue()
  })
}
