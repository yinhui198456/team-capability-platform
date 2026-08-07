import type { Page } from '@playwright/test'

export type AssignedMember = {
  id: number
  username: string
  full_name: string
}

export async function mockBuddyReviewData(page: Page): Promise<void> {
  const assignedMembers: AssignedMember[] = [
    { id: 3, username: 'member', full_name: 'Member User' },
    { id: 5, username: 'member2', full_name: 'Member Two' },
  ]

  await page.route('/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 2,
        username: 'buddy',
        full_name: 'Buddy User',
        roles: ['Buddy'],
        primary_buddy: null,
        assigned_members: assignedMembers,
      }),
    })
  })

  await page.route('/api/assessments/reviews/pending', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 101,
          assessment_id: 201,
          sequence: 1,
          buddy_id: 2,
          status: '待复核',
          member_id: 3,
          year: 2026,
          version: 1,
          assessment_status: '待复核',
          submitted_at: '2026-07-18T09:30:00+08:00',
        },
        {
          id: 102,
          assessment_id: 202,
          sequence: 1,
          buddy_id: 2,
          status: '待复核',
          member_id: 5,
          year: 2026,
          version: 1,
          assessment_status: '待复核',
          submitted_at: '2026-07-19T14:00:00+08:00',
        },
      ]),
    })
  })

  await page.route('/api/assessments/reviews/summary*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pending_count: 2, completed_count: 1 }),
    })
  })

  await page.route('/api/planning/evidence-reviews/pending', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 301,
          evidence_id: 401,
          version_number: 1,
          status: '待 Review',
          conclusion: null,
          feedback: null,
          reviewed_at: null,
          created_at: '2026-07-19T10:00:00+08:00',
          submitted_at: '2026-07-19T10:00:00+08:00',
          member_id: 3,
          username: 'member',
          learning_task_id: 501,
          l3_code: 'P01.01.01',
          l2_code: 'P01.01',
          l2_name: '数据基础',
          l3_name: '数据管道基础',
          content: '完成数据管道基础文档与示例代码。',
          evidence_link: 'https://example.invalid/tcp-demo-evidence',
        },
      ]),
    })
  })

  await page.route('/api/planning/evidence-reviews/summary*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pending_count: 1, completed_count: 2 }),
    })
  })

  await page.route(/\/api\/assessments\/201$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 201,
        member_id: 3,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '待复核',
        created_at: '2026-07-18T09:30:00+08:00',
        submitted_at: '2026-07-18T09:30:00+08:00',
        archived_at: null,
        member_current_level: 'P5',
        member_target_level: 'P6',
        l2_groups: [
          {
            l1_code: 'P01',
            l1_name: '数据基础设施',
            l2_code: 'P01.01',
            l2_name: '数据基础',
            l3_count: 1,
            is_empty: false,
            requirements: {
              P4: '理解基础概念',
              P5: '独立完成常规工作',
              P6: '能够负责复杂场景',
              P7: '推动跨团队协作',
              P8: '定义领域方向',
            },
            details: [
              {
                id: 1,
                l3_code: 'P01.01.01',
                l3_name: '数据管道基础',
                l1_code: 'P01',
                l1_name: '数据基础设施',
                l2_code: 'P01.01',
                l2_name: '数据基础',
                current_level: 2,
                target_level: 4,
                standard_target_applicable: true,
                standard_target_level: 3,
                target_adjusted: true,
                adjusted_target_level: 4,
                target_adjustment_reason:
                  '岗位项目要求：本年度负责数据平台迁移项目，需独立完成端到端数据管道设计与实施，涉及多团队协作与架构评审，对当前岗位为必备能力要求且需在年末前达成',
                gap_value: 2,
                evidence_note: '已参与数据管道搭建，完成基础文档。',
              },
            ],
          },
          {
            l1_code: null,
            l1_name: null,
            l2_code: null,
            l2_name: '未映射历史项',
            l3_count: 1,
            is_empty: false,
            details: [
              {
                id: 99,
                l3_code: 'unknown-legacy-l3',
                current_level: 1,
                target_level: 4,
                standard_target_applicable: true,
                standard_target_level: 3,
                target_adjusted: false,
                gap_value: 3,
                evidence_note: '历史依据仍可复核。',
              },
            ],
          },
        ],
        details: [
          {
            id: 1,
            l3_code: 'P01.01.01',
            l3_name: '数据管道基础',
            current_level: 2,
            target_level: 4,
            standard_target_applicable: true,
            standard_target_level: 3,
            target_adjusted: true,
            adjusted_target_level: 4,
            target_adjustment_reason:
              '岗位项目要求：本年度负责数据平台迁移项目，需独立完成端到端数据管道设计与实施，涉及多团队协作与架构评审，对当前岗位为必备能力要求且需在年末前达成',
            gap_value: 2,
            evidence_note: '已参与数据管道搭建，完成基础文档。',
            plan_candidate: false,
            recommended_start_level: '1',
            l1_code: 'P01',
            l1_name: '数据基础设施',
            l2_code: 'P01.01',
            l2_name: '数据基础',
          },
          {
            id: 2,
            l3_code: 'P02.01.01',
            l3_name: '模型部署流程',
            current_level: 1,
            target_level: 3,
            standard_target_applicable: true,
            standard_target_level: 3,
            target_adjusted: false,
            gap_value: 2,
            evidence_note: '尚未独立完成模型部署。',
            plan_candidate: false,
            recommended_start_level: '1',
            l1_code: 'P02',
            l1_name: 'AI Infra / Agent',
          },
          {
            id: 99,
            l3_code: 'unknown-legacy-l3',
            current_level: 1,
            target_level: 4,
            standard_target_applicable: true,
            standard_target_level: 3,
            target_adjusted: false,
            gap_value: 3,
            evidence_note: '历史依据仍可复核。',
            plan_candidate: false,
          },
        ],
        gap_summary: {
          total_gaps: 2,
          avg_gap: 2,
          high_priority: 0,
          medium_priority: 2,
          low_priority: 0,
        },
      }),
    })
  })

  await page.route(/\/api\/assessments\/202$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 202,
        member_id: 5,
        year: 2026,
        version: 1,
        assessment_type: '年度',
        status: '待复核',
        created_at: '2026-07-19T14:00:00+08:00',
        submitted_at: '2026-07-19T14:00:00+08:00',
        archived_at: null,
        member_current_level: 'P4',
        member_target_level: null,
        l2_groups: [
          {
            l1_code: 'C02',
            l1_name: '沟通协作',
            l2_code: 'C02.01',
            l2_name: '技术表达',
            l3_count: 1,
            is_empty: false,
            requirements: {
              P4: '清晰表达基础内容',
              P5: '独立完成技术表达',
              P6: '推动复杂方案共识',
              P7: '跨团队引领表达',
              P8: '定义组织表达标准',
            },
            details: [
              {
                id: 3,
                l3_code: 'C02.01.01',
                l3_name: '技术方案写作',
                l1_code: 'C02',
                l1_name: '沟通协作',
                l2_code: 'C02.01',
                l2_name: '技术表达',
                current_level: 2,
                target_level: 4,
                standard_target_applicable: true,
                standard_target_level: 4,
                target_adjusted: false,
                gap_value: 2,
                evidence_note: '已完成 1 篇技术方案。',
              },
            ],
          },
        ],
        details: [
          {
            id: 3,
            l3_code: 'C02.01.01',
            l3_name: '技术方案写作',
            current_level: 2,
            target_level: 4,
            standard_target_applicable: true,
            standard_target_level: 4,
            target_adjusted: false,
            gap_value: 2,
            evidence_note: '已完成 1 篇技术方案。',
            plan_candidate: false,
            recommended_start_level: '1',
            l1_code: 'C02',
            l1_name: '沟通协作',
            l2_code: 'C02.01',
            l2_name: '技术表达',
          },
        ],
        gap_summary: {
          total_gaps: 1,
          avg_gap: 2,
          high_priority: 0,
          medium_priority: 1,
          low_priority: 0,
        },
      }),
    })
  })

  await page.route(/\/api\/assessments\/201\/history/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 1001,
          assessment_id: 201,
          sequence: 0,
          buddy_id: 2,
          conclusion: '认可',
          feedback: '上次自评认可，继续按计划提升。',
          reviewed_at: '2026-01-15T10:00:00+08:00',
          status: '已闭环',
        },
      ]),
    })
  })

  await page.route(/\/api\/assessments\/202\/history/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    })
  })

  await page.route(
    /\/api\/planning\/learning-tasks\/501\/evidence-reviews/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 2001,
            evidence_id: 401,
            version_number: 1,
            status: '通过',
            conclusion: '通过',
            feedback: 'Evidence 充分，通过。',
            reviewed_at: '2026-02-10T11:00:00+08:00',
            created_at: '2026-02-10T11:00:00+08:00',
          },
          {
            id: 2002,
            evidence_id: 401,
            version_number: 1,
            status: '需补充',
            conclusion: '需补充',
            feedback: '请补充数据质量监控截图。',
            reviewed_at: '2026-03-05T14:00:00+08:00',
            created_at: '2026-03-05T14:00:00+08:00',
          },
          {
            id: 2003,
            evidence_id: 401,
            version_number: 1,
            status: '驳回',
            conclusion: '驳回',
            feedback: '链接无法访问，请重新提交。',
            reviewed_at: '2026-04-12T09:30:00+08:00',
            created_at: '2026-04-12T09:30:00+08:00',
          },
        ]),
      })
    },
  )
}

export async function mockBuddyReviewEmptyData(page: Page): Promise<void> {
  await page.route('/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 2,
        username: 'buddy',
        full_name: 'Buddy User',
        roles: ['Buddy'],
        primary_buddy: null,
        assigned_members: [
          { id: 3, username: 'member', full_name: 'Member User' },
        ],
      }),
    })
  })

  await page.route('/api/assessments/reviews/pending', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify([]) })
  })
  await page.route('/api/planning/evidence-reviews/pending', async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify([]) })
  })
  await page.route('/api/assessments/reviews/summary*', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({ pending_count: 0, completed_count: 0 }),
    })
  })
  await page.route('/api/planning/evidence-reviews/summary*', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({ pending_count: 0, completed_count: 0 }),
    })
  })
}

export async function mockBuddyReviewWorkspaceRoutes(
  page: Page,
): Promise<void> {
  // Issue #62 Buddy Review workspace DTO (frozen facts only).
  const workspace201 = {
    assessment_id: 201,
    member_id: 3,
    year: 2026,
    version: 1,
    assessment_status: '待复核',
    revision: 3,
    member_current_level_snapshot: 'P5',
    member_target_level_snapshot: 'P6',
    standard_version: { id: 1, label: 'Legacy Baseline v1' },
    summary: {
      total: 3,
      current_required: 2,
      target_progressive: 1,
      assessed: 3,
      gap_items: 3,
      high: 1,
      medium: 2,
      low: 0,
      hold: 0,
      in_plan: 1,
      by_quarter: { Q1: 0, Q2: 1, Q3: 0, Q4: 0 },
      adjustments: 1,
      data_issues: 0,
      existing_formal_plan: false,
      will_create_proposal: false,
      target_is_legacy: null,
    },
    details: [
      {
        id: 1,
        l3_code: 'P01.01.01',
        l3_name: '数据管道基础',
        l1_code: 'P01',
        l1_name: '数据基础设施',
        l2_code: 'P01.01',
        l2_name: '数据基础',
        scope_type: 'current_required',
        standard_job_level_snapshot: 'P5',
        current_level: 2,
        target_level: 4,
        standard_target_applicable: true,
        standard_target_level: 3,
        target_adjusted: true,
        adjusted_target_level: 4,
        target_adjustment_reason:
          '岗位项目要求：本年度负责数据平台迁移项目，需独立完成端到端数据管道设计与实施，涉及多团队协作与架构评审，对当前岗位为必备能力要求且需在年末前达成',
        gap_value: 2,
        member_priority: '高',
        include_in_plan: true,
        plan_quarter: 'Q2',
        plan_month: 5,
        data_issue: false,
      },
      {
        id: 2,
        l3_code: 'P02.01.01',
        l3_name: '模型部署流程',
        l1_code: 'P02',
        l1_name: 'AI Infra / Agent',
        l2_code: 'P02.01',
        l2_name: '模型服务',
        scope_type: 'target_progressive',
        standard_job_level_snapshot: 'P6',
        current_level: 1,
        target_level: 3,
        standard_target_applicable: true,
        standard_target_level: 3,
        target_adjusted: false,
        gap_value: 2,
        member_priority: '中',
        include_in_plan: false,
        data_issue: false,
      },
      {
        id: 99,
        l3_code: 'unknown-legacy-l3',
        l3_name: null,
        l1_code: null,
        l1_name: null,
        l2_code: null,
        l2_name: null,
        scope_type: null,
        standard_job_level_snapshot: null,
        current_level: 1,
        target_level: 4,
        standard_target_applicable: true,
        standard_target_level: 3,
        target_adjusted: false,
        gap_value: 3,
        member_priority: '中',
        include_in_plan: false,
        data_issue: false,
      },
    ],
  }
  await page.route(/\/api\/assessments\/201\/buddy-review/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(workspace201),
    })
  })
  await page.route(/\/api\/assessments\/202\/buddy-review/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...workspace201,
        assessment_id: 202,
        member_id: 5,
        member_current_level_snapshot: 'P4',
        member_target_level_snapshot: 'P5',
        summary: {
          ...workspace201.summary,
          total: 1,
          current_required: 1,
          in_plan: 0,
          existing_formal_plan: true,
          will_create_proposal: true,
          target_is_legacy: false,
        },
        details: [
          {
            id: 3,
            l3_code: 'P01.01.01',
            l3_name: '数据管道基础',
            l1_code: 'P01',
            l1_name: '数据基础设施',
            l2_code: 'P01.01',
            l2_name: '数据基础',
            scope_type: 'current_required',
            standard_job_level_snapshot: 'P4',
            current_level: 2,
            target_level: 4,
            standard_target_applicable: true,
            standard_target_level: 3,
            target_adjusted: false,
            gap_value: 2,
            member_priority: '中',
            include_in_plan: false,
            data_issue: false,
          },
        ],
      }),
    })
  })
}
