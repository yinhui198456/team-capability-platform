import type { AnnualPlan, LearningTask, ProgressLog, Evidence } from '../planning'
import { isMockEnabled as mockOn } from './memberDashboard'

export function isMockEnabled(): boolean { return mockOn() }

export const mockPlan: AnnualPlan = {
  id: 1, member_id: 1, year: 2026, plan_cycle: 12, status: '执行中',
  start_date: '2026-01-01', end_date: '2026-12-31', created_at: '2026-01-01T00:00:00Z',
  items: [
    { id: 1, annual_growth_plan_id: 1, growth_goal_id: 1, l3_code: 'P01.01.01', current_level: 2, target_level: 4, priority: '中', learning_material: '数据工程指南', learning_task_content: '搭建数据管道并完成文档', expected_output: '数据管道 + 口径文档', estimated_hours: '24', plan_start_date: '2026-03-01', plan_end_date: '2026-04-30', target_month: 3, status: '已完成' },
    { id: 2, annual_growth_plan_id: 1, growth_goal_id: 2, l3_code: 'P02.01.01', current_level: 1, target_level: 3, priority: '中', learning_material: 'MLOps 实践', learning_task_content: '实现模型部署 CI/CD', expected_output: 'CI/CD pipeline', estimated_hours: '32', plan_start_date: '2026-02-01', plan_end_date: '2026-05-31', target_month: 4, status: '延期' },
    { id: 3, annual_growth_plan_id: 1, growth_goal_id: 3, l3_code: 'C02.01.01', current_level: 1, target_level: 4, priority: '高', learning_material: null, learning_task_content: '完成 3 篇技术方案', expected_output: '3 篇方案文档', estimated_hours: '20', plan_start_date: '2026-01-01', plan_end_date: '2026-03-31', target_month: 2, status: '延期' },
    { id: 4, annual_growth_plan_id: 1, growth_goal_id: 4, l3_code: 'P03.02.01', current_level: 2, target_level: 4, priority: '中', learning_material: '测试最佳实践', learning_task_content: '为模块补充单元测试', expected_output: '测试覆盖率 > 80%', estimated_hours: '16', plan_start_date: '2026-04-01', plan_end_date: '2026-06-30', target_month: 5, status: '进行中' },
    { id: 5, annual_growth_plan_id: 1, growth_goal_id: 5, l3_code: 'C01.01.01', current_level: 3, target_level: 5, priority: '中', learning_material: null, learning_task_content: '掌握高级 Excel 分析', expected_output: '分析模型 + 报告', estimated_hours: '12', plan_start_date: '2026-06-01', plan_end_date: '2026-08-31', target_month: 7, status: '未开始' },
    { id: 6, annual_growth_plan_id: 1, growth_goal_id: 6, l3_code: 'C03.01.01', current_level: 2, target_level: 4, priority: '中', learning_material: null, learning_task_content: '完成技术调研方法论学习', expected_output: '调研报告模板', estimated_hours: '8', plan_start_date: '2026-05-01', plan_end_date: '2026-06-30', target_month: 5, status: '已完成' },
    { id: 7, annual_growth_plan_id: 1, growth_goal_id: 7, l3_code: 'P01.02.01', current_level: 2, target_level: 5, priority: '高', learning_material: '数据质量框架', learning_task_content: '建立数据质量监控体系', expected_output: '监控 dashboard', estimated_hours: '40', plan_start_date: '2026-07-01', plan_end_date: '2026-10-31', target_month: 8, status: '未开始' },
    { id: 8, annual_growth_plan_id: 1, growth_goal_id: 8, l3_code: 'P02.02.01', current_level: 1, target_level: 3, priority: '中', learning_material: null, learning_task_content: '搭建 Agent 开发环境', expected_output: '可用的 Agent 工具链', estimated_hours: '28', plan_start_date: '2026-03-01', plan_end_date: '2026-06-30', target_month: 4, status: '进行中' },
  ],
}

export const mockTasks: Record<number, LearningTask> = {
  1: { id: 1, plan_item_id: 1, l3_code: 'P01.01.01', l3_name: '数据管道基础', status: '已完成', actual_start_date: '2026-03-01', actual_end_date: '2026-04-15', actual_hours: 22, completion_quality: '达标', review_conclusion: 'Evidence 通过', next_action: null, plan_item_current_level: 2, plan_item_target_level: 4, plan_item_priority: '中', plan_item_learning_material: '数据工程指南', plan_item_learning_task_content: '搭建数据管道并完成文档', plan_item_expected_output: '数据管道 + 口径文档', plan_item_estimated_hours: '24', plan_item_target_month: 3 },
  2: { id: 2, plan_item_id: 2, l3_code: 'P02.01.01', l3_name: '模型部署流程', status: '延期', actual_start_date: '2026-02-01', actual_end_date: null, actual_hours: 8, completion_quality: null, review_conclusion: null, next_action: '7 月 25 日前协调资源，无法落实则调整学习任务', delay_reason: '等待 GPU 资源分配', plan_item_current_level: 1, plan_item_target_level: 3, plan_item_priority: '中', plan_item_learning_material: 'MLOps 实践', plan_item_learning_task_content: '实现模型部署 CI/CD', plan_item_expected_output: 'CI/CD pipeline', plan_item_estimated_hours: '32', plan_item_target_month: 4 },
  3: { id: 3, plan_item_id: 3, l3_code: 'C02.01.01', l3_name: '技术方案写作', status: '延期', actual_start_date: '2026-01-01', actual_end_date: null, actual_hours: 5, completion_quality: null, review_conclusion: null, next_action: '需补充第三篇方案', delay_reason: '其他高优先级任务插入', plan_item_current_level: 1, plan_item_target_level: 4, plan_item_priority: '高', plan_item_learning_material: null, plan_item_learning_task_content: '完成 3 篇技术方案', plan_item_expected_output: '3 篇方案文档', plan_item_estimated_hours: '20', plan_item_target_month: 2 },
  4: { id: 4, plan_item_id: 4, l3_code: 'P03.02.01', l3_name: '单元测试实践', status: '进行中', actual_start_date: '2026-04-01', actual_end_date: null, actual_hours: 6, completion_quality: null, review_conclusion: null, next_action: '补充边界用例', plan_item_current_level: 2, plan_item_target_level: 4, plan_item_priority: '中', plan_item_learning_material: '测试最佳实践', plan_item_learning_task_content: '为模块补充单元测试', plan_item_expected_output: '测试覆盖率 > 80%', plan_item_estimated_hours: '16', plan_item_target_month: 5 },
  8: { id: 8, plan_item_id: 8, l3_code: 'P02.02.01', l3_name: 'Agent 工具链搭建', status: '进行中', actual_start_date: '2026-03-15', actual_end_date: null, actual_hours: 12, completion_quality: null, review_conclusion: null, next_action: '集成 LangChain 框架', plan_item_current_level: 1, plan_item_target_level: 3, plan_item_priority: '中', plan_item_learning_material: null, plan_item_learning_task_content: '搭建 Agent 开发环境', plan_item_expected_output: '可用的 Agent 工具链', plan_item_estimated_hours: '28', plan_item_target_month: 4 },
}

export const mockLogs: Record<number, ProgressLog[]> = {
  1: [{ id: 1, task_id: 1, record_date: '2026-03-15', actual_hours: 8, note: '阅读数据管道文档', recorder_id: 1 }, { id: 2, task_id: 1, record_date: '2026-04-01', actual_hours: 14, note: '搭建 + 测试', recorder_id: 1 }],
  2: [{ id: 3, task_id: 2, record_date: '2026-02-10', actual_hours: 5, note: '环境搭建', recorder_id: 1 }, { id: 4, task_id: 2, record_date: '2026-03-20', actual_hours: 3, note: '调试 CI/CD 脚本', recorder_id: 1 }],
  3: [{ id: 5, task_id: 3, record_date: '2026-01-15', actual_hours: 5, note: '完成第一篇方案', recorder_id: 1 }],
  4: [{ id: 6, task_id: 4, record_date: '2026-04-15', actual_hours: 6, note: '补充核心模块测试', recorder_id: 1 }],
  8: [{ id: 7, task_id: 8, record_date: '2026-03-20', actual_hours: 8, note: 'LangChain 调研 + 环境', recorder_id: 1 }, { id: 8, task_id: 8, record_date: '2026-04-10', actual_hours: 4, note: '工具链集成', recorder_id: 1 }],
}

export const mockEvidences: Record<number, Evidence[]> = {
  1: [{ id: 1, learning_task_id: 1, l3_code: 'P01.01.01', version_number: 1, content: '数据管道已部署，口径文档完成', evidence_link: 'https://wiki.example.com/data-pipeline', status: '通过', submitted_at: '2026-04-10', created_at: '2026-04-01' }],
  2: [{ id: 2, learning_task_id: 2, l3_code: 'P02.01.01', version_number: 1, content: 'CI/CD 脚本初版完成，待 GPU 资源联调', evidence_link: '', status: '待 Review', submitted_at: '2026-03-25', created_at: '2026-03-20' }],
  3: [{ id: 3, learning_task_id: 3, l3_code: 'C02.01.01', version_number: 1, content: '已完成一篇 API 设计文档', evidence_link: '', status: '需补充', submitted_at: '2026-02-01', created_at: '2026-01-20' }],
}
