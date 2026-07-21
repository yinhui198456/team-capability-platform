import type { Page } from '@playwright/test'

// Static, deterministic data for UI-05 visual regression.
// No Math.random, no time-based seeds, no viewport-dependent generation.

const domainLabels: Record<string, string> = {
  P01: 'Data Infra',
  P02: 'AI Infra / Agent',
  P03: 'Coding',
  C01: '基本办公',
  C02: '沟通协作',
  C03: '学习创新',
}

const domainOrder = ['P01', 'P02', 'P03', 'C01', 'C02', 'C03']

const members = [
  { member_id: 3, username: 'member', full_name: '张三' },
  { member_id: 5, username: 'member2', full_name: '李四' },
  { member_id: 7, username: 'member3', full_name: '王五' },
]

// Per-member actual/plan per domain (same source for domain averages & heatmap)
const memberDomainGrids: Record<number, Record<string, { actual: number; plan: number }>> = {
  3: {
    P01: { actual: 2.5, plan: 4.0 },
    P02: { actual: 1.5, plan: 3.5 },
    P03: { actual: 3.5, plan: 4.0 },
    C01: { actual: 3.8, plan: 4.0 },
    C02: { actual: 2.5, plan: 3.5 },
    C03: { actual: 2.0, plan: 3.0 },
  },
  5: {
    P01: { actual: 3.0, plan: 4.0 },
    P02: { actual: 1.4, plan: 3.5 },
    P03: { actual: 3.2, plan: 4.0 },
    C01: { actual: 4.0, plan: 4.0 },
    C02: { actual: 3.0, plan: 3.5 },
    C03: { actual: 2.5, plan: 3.0 },
  },
  7: {
    P01: { actual: 3.5, plan: 4.0 },
    P02: { actual: 3.0, plan: 3.5 },
    P03: { actual: 4.0, plan: 4.0 },
    C01: { actual: 4.2, plan: 4.0 },
    C02: { actual: 3.5, plan: 3.5 },
    C03: { actual: 3.0, plan: 3.0 },
  },
}

function attainment(actual: number, plan: number): number | null {
  if (plan === 0) return null
  return Math.round((actual / plan) * 100)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function buildDomainAverages(memberIds: number[], domainCodes: string[]) {
  return domainCodes.map((code) => {
    const values = memberIds
      .map((id) => memberDomainGrids[id][code])
      .filter(Boolean)
    const actual = round1(values.reduce((sum, v) => sum + v.actual, 0) / values.length)
    const plan = round1(values.reduce((sum, v) => sum + v.plan, 0) / values.length)
    return { domain_code: code, actual, target: plan }
  })
}

function buildMemberAttainment(memberIds: number[], domainCodes: string[]) {
  const result: Array<{
    member_id: number
    username: string
    full_name: string
    domain_code: string
    attainment: number | null
    actual: number | null
    target: number | null
  }> = []
  for (const member of members.filter((m) => memberIds.includes(m.member_id))) {
    for (const code of domainCodes) {
      const grid = memberDomainGrids[member.member_id][code]
      const att = grid ? attainment(grid.actual, grid.plan) : null
      result.push({
        ...member,
        domain_code: code,
        attainment: att,
        actual: grid ? grid.actual : null,
        target: grid ? grid.plan : null,
      })
    }
  }
  return result
}

// 12-month trends: base values that change deterministically by filter.
function buildMonthlyTrends(memberId: number | null, domainCode: string | null) {
  const memberMultiplier = memberId === 3 ? 0.9 : memberId === 5 ? 0.8 : memberId === 7 ? 1.1 : 1.0
  const domainMultiplier = domainCode ? 0.7 : 1.0
  const scale = memberMultiplier * domainMultiplier

  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const plannedCount = Math.round((month <= 7 ? i + 1 : Math.max(1, 12 - i)) * scale)
    const actualCount = Math.max(0, plannedCount - (i % 3 === 0 ? 1 : 0))
    const plannedHours = plannedCount * 8
    const actualHours = actualCount * 8 + (i % 4 === 0 ? 2 : 0)
    const cumPlannedCount = Array.from({ length: month }, (_, j) =>
      Math.round((Math.min(j + 1, plannedCount) / scale) * scale),
    ).reduce((a, b) => a + b, 0)
    const cumActualCount = Array.from({ length: month }, (_, j) =>
      Math.max(0, Math.min(j + 1, plannedCount) - (j % 3 === 0 ? 1 : 0)),
    ).reduce((a, b) => a + b, 0)
    const totalItems = Math.round(36 * scale)
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
}

const overdueCatalog = [
  {
    member_id: 3,
    username: 'member',
    full_name: '张三',
    l3_code: 'P01-L2A-L3A',
    l3_name: '数据建模与治理',
    due_date: '2026-06-15',
    plan_start_date: '2026-05-01',
    plan_end_date: '2026-06-15',
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
    plan_start_date: '2026-03-15',
    plan_end_date: '2026-05-01',
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
    plan_start_date: '2026-06-01',
    plan_end_date: '2026-07-01',
    overdue_days: 19,
    status: '进行中',
  },
]

const kpisByFilter: Record<string, { plan_rate: number; plan_done: number; plan_total: number; evidence_rate: number; evidence_passed: number; evidence_total: number }> = {
  'default': { plan_rate: 0.58, plan_done: 21, plan_total: 36, evidence_rate: 0.75, evidence_passed: 9, evidence_total: 12 },
  'member_3': { plan_rate: 0.50, plan_done: 6, plan_total: 12, evidence_rate: 0.67, evidence_passed: 4, evidence_total: 6 },
  'member_5': { plan_rate: 0.60, plan_done: 9, plan_total: 15, evidence_rate: 0.80, evidence_passed: 4, evidence_total: 5 },
  'member_7': { plan_rate: 0.75, plan_done: 9, plan_total: 12, evidence_rate: 0.83, evidence_passed: 5, evidence_total: 6 },
  'domain_P01': { plan_rate: 0.55, plan_done: 5, plan_total: 9, evidence_rate: 0.70, evidence_passed: 7, evidence_total: 10 },
  'domain_P02': { plan_rate: 0.43, plan_done: 3, plan_total: 7, evidence_rate: 0.60, evidence_passed: 3, evidence_total: 5 },
  'member_5_domain_P02': { plan_rate: 0.40, plan_done: 2, plan_total: 5, evidence_rate: 0.50, evidence_passed: 1, evidence_total: 2 },
}

function resolveKpis(memberId: number | null, domainCode: string | null) {
  const key = memberId && domainCode
    ? `member_${memberId}_domain_${domainCode}`
    : memberId
      ? `member_${memberId}`
      : domainCode
        ? `domain_${domainCode}`
        : 'default'
  return kpisByFilter[key] ?? kpisByFilter['default']
}

export async function mockTeamAnalyticsData(page: Page): Promise<void> {
  await page.route('/api/planning/team-analytics*', async (route) => {
    const url = new URL(route.request().url())
    const memberId = url.searchParams.get('member_id')
      ? Number(url.searchParams.get('member_id'))
      : null
    const domainCode = url.searchParams.get('domain_code') || null

    const memberIds = memberId
      ? [memberId]
      : members.map((m) => m.member_id)
    const domainCodes = domainCode
      ? [domainCode]
      : domainOrder

    const memberIdSet = new Set(memberIds)
    const filteredOverdue = overdueCatalog.filter((item) =>
      memberIdSet.has(item.member_id) && (domainCode ? item.l3_code.startsWith(domainCode) : true),
    )

    const kpis = resolveKpis(memberId, domainCode)
    const domainAverages = buildDomainAverages(memberIds, domainCodes)
    const memberAttainment = buildMemberAttainment(memberIds, domainCodes)
    const monthlyTrends = buildMonthlyTrends(memberId, domainCode)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        year: 2026,
        filters: { member_id: memberId, domain_code: domainCode },
        kpis: {
          assessment_completion_rate: 0.67,
          assessment_completed_count: 2,
          assessment_total_count: 3,
          plan_completion_rate: kpis.plan_rate,
          plan_completed_count: kpis.plan_done,
          plan_total_count: kpis.plan_total,
          evidence_pass_rate: kpis.evidence_rate,
          evidence_passed_count: kpis.evidence_passed,
          evidence_total_count: kpis.evidence_total,
          overdue_plan_item_count: filteredOverdue.length,
        },
        domain_averages: domainAverages,
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
        domain_averages: domainOrder.map((code) => ({ domain_code: code, actual: 0, target: 0 })),
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
