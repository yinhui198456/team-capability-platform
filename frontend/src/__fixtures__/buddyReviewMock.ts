// Mock fixture for Buddy Review Center — enabled via VITE_ENABLE_MOCK=true

import type { PendingReview } from '../assessmentReview'
import type { EvidenceReview } from '../planning'
import { isMockEnabled as baseIsMockEnabled } from './memberDashboard'

export function isMockEnabled(): boolean {
  return baseIsMockEnabled()
}

export type AssignedMember = {
  id: number
  username: string
  full_name: string
}

export const mockAssignedMembers: AssignedMember[] = [
  { id: 3, username: 'member', full_name: 'Member User' },
  { id: 5, username: 'member2', full_name: 'Member Two' },
]

export const mockAssessmentReviews: PendingReview[] = [
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
]

export const mockEvidenceReviews: EvidenceReview[] = [
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
    content: '本地演示 Evidence：完成数据管道基础文档。',
    evidence_link: 'https://example.invalid/tcp-demo-evidence',
  },
]

export type ReviewSummary = {
  pending_count: number
  completed_count: number
}

export const mockAssessmentReviewSummary: ReviewSummary = {
  pending_count: 2,
  completed_count: 1,
}

export const mockEvidenceReviewSummary: ReviewSummary = {
  pending_count: 1,
  completed_count: 2,
}

export type AssessmentDetailHistory = {
  l3_code: string
  l3_name?: string
  current_level: number
  target_level: number
  gap_value: number
  evidence_note?: string | null
}

export const mockAssessmentDetails: Record<number, AssessmentDetailHistory[]> =
  {
    201: [
      {
        l3_code: 'P01.01.01',
        l3_name: '数据管道基础',
        current_level: 2,
        target_level: 4,
        gap_value: 2,
        evidence_note: '已参与数据管道搭建，完成基础文档。',
      },
      {
        l3_code: 'P02.01.01',
        l3_name: '模型部署流程',
        current_level: 1,
        target_level: 3,
        gap_value: 2,
        evidence_note: '尚未独立完成模型部署。',
      },
    ],
    202: [
      {
        l3_code: 'C02.01.01',
        l3_name: '技术方案写作',
        current_level: 2,
        target_level: 4,
        gap_value: 2,
        evidence_note: '已完成 1 篇技术方案。',
      },
    ],
  }

export type HistoryItem = {
  id: number
  status: string
  conclusion: string | null
  feedback: string | null
  reviewed_at: string
}

export const mockAssessmentHistories: Record<number, HistoryItem[]> = {
  201: [
    {
      id: 1001,
      status: '已闭环',
      conclusion: '认可',
      feedback: '上次自评认可，继续按计划提升。',
      reviewed_at: '2026-01-15T10:00:00+08:00',
    },
  ],
}

export const mockEvidenceHistories: Record<number, HistoryItem[]> = {
  501: [
    {
      id: 2001,
      status: '通过',
      conclusion: '通过',
      feedback: 'Evidence 充分，通过。',
      reviewed_at: '2026-02-10T11:00:00+08:00',
    },
    {
      id: 2002,
      status: '需补充',
      conclusion: '需补充',
      feedback: '请补充数据质量监控截图。',
      reviewed_at: '2026-03-05T14:00:00+08:00',
    },
    {
      id: 2003,
      status: '驳回',
      conclusion: '驳回',
      feedback: '链接无法访问，请重新提交。',
      reviewed_at: '2026-04-12T09:30:00+08:00',
    },
  ],
}
