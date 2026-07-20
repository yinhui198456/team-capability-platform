import type { Page } from '@playwright/test'

export async function mockTeamAnalyticsData(page: Page): Promise<void> {
  await page.route('/api/planning/team-analytics*', async (route) => {
    const url = new URL(route.request().url())
    const memberId = url.searchParams.get('member_id')
    const domainCode = url.searchParams.get('domain_code')

    const allMembers = [
      { member_id: 3, username: 'member', full_name: '张三' },
      { member_id: 5, username: 'member2', full_name: '李四' },
      { member_id: 7, username: 'member3', full_name: '王五' },
    ]

    const members = memberId
      ? allMembers.filter((m) => m.member_id === Number(memberId))
      : allMembers

    const allDomains = [
      { domain_code: 'P01', actual: 3.2, target: 4.0 },
      { domain_code: 'P02', actual: 2.0, target: 3.5 },
      { domain_code: 'P03', actual: 3.8, target: 4.0 },
      { domain_code: 'C01', actual: 4.2, target: 4.0 },
      { domain_code: 'C02', actual: 3.0, target: 3.5 },
      { domain_code: 'C03', actual: 2.5, target: 3.0 },
    ]
    const domains = domainCode
      ? allDomains.filter((d) => d.domain_code === domainCode)
      : allDomains

    const memberAttainment: Array<{
      member_id: number
      username: string
      full_name: string
      domain_code: string
      attainment: number | null
      actual: number | null
      target: number | null
    }> = []
    for (const m of members) {
      for (const d of domains) {
        const actual = d.actual * (0.7 + Math.random() * 0.5)
        const target = d.target
        memberAttainment.push({
          member_id: m.member_id,
          username: m.username,
          full_name: m.full_name,
          domain_code: d.domain_code,
          attainment: target > 0 ? Math.round((actual / target) * 100) : null,
          actual: Math.round(actual * 10) / 10,
          target,
        })
      }
    }

    const memberIds = new Set(members.map((m) => m.member_id))
    const overdueItems = memberId
      ? [
          {
            member_id: members[0].member_id,
            username: members[0].username,
            full_name: members[0].full_name,
            l3_code: 'P01-L2A-L3A',
            l3_name: '数据建模与治理',
            due_date: '2026-06-15',
            overdue_days: 35,
            status: '进行中',
          },
          {
            member_id: members[0].member_id,
            username: members[0].username,
            full_name: members[0].full_name,
            l3_code: 'P02-L1B-L2A',
            l3_name: 'ML Pipeline 搭建',
            due_date: '2026-05-01',
            overdue_days: 80,
            status: '延期',
          },
        ]
      : [
          {
            member_id: 3,
            username: 'member',
            full_name: '张三',
            l3_code: 'P01-L2A-L3A',
            l3_name: '数据建模与治理',
            due_date: '2026-06-15',
            overdue_days: 35,
            status: '进行中',
          },
          {
            member_id: 5,
            username: 'member2',
            full_name: '李四',
            l3_code: 'P02-L1B-L2A',
            l3_name: 'ML Pipeline 搭建',
            due_date: '2026-05-01',
            overdue_days: 80,
            status: '延期',
          },
          {
            member_id: 7,
            username: 'member3',
            full_name: '王五',
            l3_code: 'C03-L2A-L3A',
            l3_name: '技术创新提案',
            due_date: '2026-07-01',
            overdue_days: 19,
            status: '进行中',
          },
        ]

    // Filter overdue to only selected members
    const filteredOverdue = overdueItems.filter((item) =>
      memberIds.has(item.member_id),
    )

    const monthlyTrends = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1
      // Ramp up over the year
      const plannedCount = month <= 7 ? i + 1 : Math.max(0, 12 - i)
      const actualCount = Math.max(0, plannedCount - (Math.random() > 0.6 ? 1 : 0))
      const plannedHours = plannedCount * 8
      const actualHours = actualCount * 8 + Math.floor(Math.random() * 4)
      const cumPlannedCount = Array.from({ length: month }, (_, j) => Math.min(j + 1, plannedCount)).reduce((a, b) => a + b, 0)
      const cumActualCount = Array.from({ length: month }, (_, j) => Math.max(0, Math.min(j + 1, plannedCount) - (Math.random() > 0.6 ? 1 : 0))).reduce((a, b) => a + b, 0)
      const totalItems = 36
      return {
        month,
        planned_count: plannedCount,
        actual_count: actualCount,
        cumulative_planned_rate: Math.min(1, cumPlannedCount / totalItems),
        cumulative_actual_rate: Math.min(1, cumActualCount / totalItems),
        planned_hours: plannedHours,
        actual_hours: actualHours,
        cumulative_planned_hours: cumPlannedCount * 8,
        cumulative_actual_hours: cumActualCount * 8 + i,
      }
    })

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        year: 2026,
        filters: {
          member_id: memberId ? Number(memberId) : null,
          domain_code: domainCode || null,
        },
        kpis: {
          assessment_completion_rate: 0.67,
          assessment_completed_count: 2,
          assessment_total_count: 3,
          plan_completion_rate: 0.58,
          plan_completed_count: 21,
          plan_total_count: 36,
          evidence_pass_rate: 0.75,
          evidence_passed_count: 9,
          evidence_total_count: 12,
          overdue_plan_item_count: filteredOverdue.length,
        },
        domain_averages: domains,
        member_attainment: memberAttainment,
        monthly_trends: monthlyTrends,
        overdue_items: filteredOverdue,
      }),
    })
  })
}

export async function mockTeamAnalyticsEmptyData(page: Page): Promise<void> {
  await page.route('/api/planning/team-analytics*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        year: 2026,
        filters: { member_id: null, domain_code: null },
        kpis: {
          assessment_completion_rate: 0,
          assessment_completed_count: 0,
          assessment_total_count: 3,
          plan_completion_rate: 0,
          plan_completed_count: 0,
          plan_total_count: 0,
          evidence_pass_rate: 0,
          evidence_passed_count: 0,
          evidence_total_count: 0,
          overdue_plan_item_count: 0,
        },
        domain_averages: [
          { domain_code: 'P01', actual: 0, target: 0 },
          { domain_code: 'P02', actual: 0, target: 0 },
          { domain_code: 'P03', actual: 0, target: 0 },
          { domain_code: 'C01', actual: 0, target: 0 },
          { domain_code: 'C02', actual: 0, target: 0 },
          { domain_code: 'C03', actual: 0, target: 0 },
        ],
        member_attainment: [],
        monthly_trends: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          planned_count: 0,
          actual_count: 0,
          cumulative_planned_rate: 0,
          cumulative_actual_rate: 0,
          planned_hours: 0,
          actual_hours: 0,
          cumulative_planned_hours: 0,
          cumulative_actual_hours: 0,
        })),
        overdue_items: [],
      }),
    })
  })
}
