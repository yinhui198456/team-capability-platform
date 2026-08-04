import type { Page } from '@playwright/test'

export const growthProfileMockMember = {
  id: 1,
  username: 'member',
  full_name: '张三',
}

export const growthProfileMockMember2 = {
  id: 2,
  username: 'member2',
  full_name: '李四',
}

export function buildGrowthProfileResponse(
  member: typeof growthProfileMockMember,
) {
  return {
    id: 1,
    member_id: member.id,
    year: 2026,
    status: '已生成',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    member,
    assessments: [
      {
        id: 10,
        member_id: member.id,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '已归档',
        created_at: '2026-01-01T00:00:00Z',
        submitted_at: '2026-01-02T00:00:00Z',
        archived_at: '2026-01-03T00:00:00Z',
        reviews: [
          {
            id: 100,
            assessment_id: 10,
            sequence: 1,
            buddy_id: 2,
            status: '已闭环',
            conclusion: '认可',
            feedback: '符合预期',
            reviewed_at: '2026-01-02T00:00:00Z',
          },
        ],
      },
    ],
    annual_plan: {
      id: 20,
      member_id: member.id,
      year: 2026,
      plan_cycle: 12,
      status: '执行中',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      created_at: '2026-01-01T00:00:00Z',
      items: [
        {
          id: 30,
          annual_growth_plan_id: 20,
          growth_goal_id: 40,
          l3_code: 'P01-L2A-L3A',
          l3_name: 'TDC / TDH / ArgoDB / TDS 产品定位',
          l2_code: 'P01-L2A',
          l2_name: 'Data Infra 产品体系认知',
          current_level: 2,
          target_level: 4,
          priority: '高',
          learning_material: null,
          learning_task_content: null,
          expected_output: null,
          estimated_hours: '10',
          plan_start_date: null,
          plan_end_date: null,
          target_month: null,
          status: '已完成',
          learning_task: {
            id: 50,
            plan_item_id: 30,
            l3_code: 'P01-L2A-L3A',
            l3_name: 'TDC / TDH / ArgoDB / TDS 产品定位',
            l2_code: 'P01-L2A',
            l2_name: 'Data Infra 产品体系认知',
            status: '已完成',
            actual_start_date: '2026-03-01',
            actual_end_date: '2026-03-31',
            actual_hours: 8,
            completion_quality: '优秀',
            review_conclusion: '达成目标',
            next_action: '无',
            plan_item_current_level: 2,
            plan_item_target_level: 4,
            plan_item_priority: '高',
            plan_item_learning_material: null,
            plan_item_learning_task_content: null,
            plan_item_expected_output: null,
            plan_item_estimated_hours: '10',
            plan_item_target_month: null,
            progress_logs: [
              {
                id: 60,
                task_id: 50,
                record_date: '2026-03-15',
                actual_hours: 5,
                note: '完成 POC 与文档',
                recorder_id: member.id,
              },
              {
                id: 61,
                task_id: 50,
                record_date: '2026-03-22',
                actual_hours: 3,
                note: '代码评审与复盘',
                recorder_id: member.id,
              },
            ],
            evidences: [
              {
                id: 70,
                learning_task_id: 50,
                l3_code: 'P01-L2A-L3A',
                l2_code: 'P01-L2A',
                l2_name: 'Data Infra 产品体系认知',
                version_number: 1,
                content: '部署文档与验证报告',
                evidence_link: 'https://example.invalid/p01-evidence',
                status: '已归档',
                submitted_at: '2026-03-25T00:00:00Z',
                created_at: '2026-03-25T00:00:00Z',
                review: {
                  id: 110,
                  evidence_id: 70,
                  version_number: 1,
                  status: '已闭环',
                  conclusion: '通过',
                  feedback: '材料充分，能力已达成',
                  reviewed_at: '2026-03-26T00:00:00Z',
                },
              },
            ],
          },
        },
        {
          id: 31,
          annual_growth_plan_id: 20,
          growth_goal_id: 41,
          l3_code: 'C01-L2A-L3A',
          l3_name: '常用办公工具基础',
          l2_code: 'C01-L2A',
          l2_name: '办公效率标准',
          current_level: 3,
          target_level: 4,
          priority: '中',
          learning_material: null,
          learning_task_content: null,
          expected_output: null,
          estimated_hours: '6',
          plan_start_date: null,
          plan_end_date: null,
          target_month: null,
          status: '进行中',
          learning_task: {
            id: 51,
            plan_item_id: 31,
            l3_code: 'C01-L2A-L3A',
            l3_name: '常用办公工具基础',
            l2_code: 'C01-L2A',
            l2_name: '办公效率标准',
            status: '进行中',
            actual_start_date: null,
            actual_end_date: null,
            actual_hours: 5,
            completion_quality: null,
            review_conclusion: null,
            next_action: '补充测试用例',
            plan_item_current_level: 3,
            plan_item_target_level: 4,
            plan_item_priority: '中',
            plan_item_learning_material: null,
            plan_item_learning_task_content: null,
            plan_item_expected_output: null,
            plan_item_estimated_hours: '6',
            plan_item_target_month: null,
            progress_logs: [
              {
                id: 62,
                task_id: 51,
                record_date: '2026-05-10',
                actual_hours: 5,
                note: 'TDD 练习',
                recorder_id: member.id,
              },
            ],
            evidences: [
              {
                id: 71,
                learning_task_id: 51,
                l3_code: 'C01-L2A-L3A',
                l2_code: 'C01-L2A',
                l2_name: '办公效率标准',
                version_number: 1,
                content: 'TDD 练习记录',
                evidence_link: null,
                status: '待 Review',
                submitted_at: '2026-05-20T00:00:00Z',
                created_at: '2026-05-20T00:00:00Z',
                review: null,
              },
            ],
          },
        },
      ],
    },
    statistics: {
      total_learning_hours: 13,
      total_planned_hours: 16,
      evidence_count_by_status: {
        已归档: 1,
        '待 Review': 1,
      },
    },
    // Contract field since issue-64: monthly review trail after the plan.
    monthly_reviews: [],
  }
}

export async function mockGrowthProfileData(page: Page): Promise<void> {
  await page.route('/api/planning/profiles*', async (route) => {
    const url = new URL(route.request().url())
    const memberId = url.searchParams.get('member_id')
      ? Number(url.searchParams.get('member_id'))
      : growthProfileMockMember.id
    const member =
      memberId === growthProfileMockMember2.id
        ? growthProfileMockMember2
        : growthProfileMockMember
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildGrowthProfileResponse(member)),
    })
  })

  await page.route(
    '/api/planning/profiles/selectable-members*',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          members: [growthProfileMockMember, growthProfileMockMember2],
        }),
      })
    },
  )

  await page.route('/api/planning/available-years', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available_years: [2026], active_year: 2026 }),
    })
  })
}

export async function mockGrowthProfileEmptyData(page: Page): Promise<void> {
  await page.route('/api/planning/profiles*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1,
        member_id: growthProfileMockMember.id,
        year: 2026,
        status: '已生成',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        member: growthProfileMockMember,
        assessments: [],
        annual_plan: null,
        statistics: {
          total_learning_hours: 0,
          total_planned_hours: 0,
          evidence_count_by_status: {},
        },
        monthly_reviews: [],
      }),
    })
  })

  await page.route(
    '/api/planning/profiles/selectable-members*',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ members: [growthProfileMockMember] }),
      })
    },
  )

  await page.route('/api/planning/available-years', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available_years: [2026], active_year: 2026 }),
    })
  })
}
