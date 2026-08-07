# 指标字典（Issue #64 阶段 1）

> 唯一主源：`backend/app/planning/metrics.py` 中的 `METRIC_DICTIONARY`。本文档忠实反映代码；代码变更时同步更新。

> 阶段说明：#64 统一月度复盘、成长档案、工作台与团队分析口径。**阶段 1** 落地 3 个 Member-facing 消费者（Member Dashboard、Monthly Review、Growth Profile）；**阶段 2** 的 Team Analytics、Team Annual Plan 仅完成指标定义，未实现，见第 5 节。

## 1. 通用约定

- **as_of**：聚合响应携带服务器时间戳（数据读取时刻），标识快照时点。
- **year / scope / source**：每个聚合响应标识所属年份、权限 scope、来源（`member_dashboard.v1` / `monthly_review.v1` / `capability_profile.v1`）。
- **scope 取值**：`本人`（Member 自己）、`buddy_assigned`（被分配的 Buddy）、`leader_team`（Leader 团队范围）。Admin 不绕过业务隔离（仅本人）。
- **denominator 规则**：Member 分母只来自自己的 `assessment_detail` / `plan_item`，**不使用**标准库全部 310 个能力项作为分母。
- **任务状态**：六种 plan-item 状态（未开始/进行中/已完成/延期/暂停/取消）；不使用 legacy「待 Evidence Review」。

## 2. 共享查询层（reconciliation 保证）

`plan_items_in_month(connection, member_id, year, month)` 与 `valid_hours_by_task(connection, task_ids, year, month)` 是唯一聚合入口：

- Member Dashboard 的 `current_month` 块与 Monthly Review 的 summary/details 都由同一组语句构建 → 同一成员同一月份的口径**按构造一致**（可精确对账）。
- 均为批量查询（`WHERE ... = ANY(%s)`），不做 per-row / N+1 加载。
- `actual_hours` 只聚合 `invalidated_at IS NULL` 的 learning_progress_log，按 `record_date` 的年份/月份归属。

## 3. 阶段 1 指标（已实现）

### 3.1 member_dashboard.*（scope：本人）

| 指标 | 定义 |
|---|---|
| `meta` | as_of / year / scope / source / denominator_source（`assessment_details` 或 `planned_items`） |
| `gap_summary` | 可追踪 gap 行按 `current_required` / `target_progressive` 拆分；scope_type 取自 assessment detail 快照（scope-v1）；legacy 明细（scope_type 为 NULL）回退到「目标等级 vs 当前等级」映射并标记 `derivation=legacy_fallback` |
| `applicable_completion` | 当前（最新）assessment detail 行上的 total / completed / ratio；completed = current_level 达到有效目标等级（`COALESCE(adjusted_target_level, standard_target_level, target_level)`） |
| `current_month` | 当月 `plan_month` 计划项数及 id 列表、六状态计数、`pending_evidence_count`（最新版本 evidence 处于草稿/需补充且无后继版本）、当月有效日志 `actual_hours` |
| `next_action` | 固定决策链产出一条动作：complete_assessment → await_buddy_review → revise_assessment → submit_evidence → handle_delayed → set_priorities → none。优先级**只来自 Member 输入**：无优先级 gap 存在时才触发 set_priorities，绝不派生 |

### 3.2 monthly_review.*（scope：本人 / buddy_assigned / leader_team）

| 指标 | 定义 |
|---|---|
| `summary` | planned_count / completed_count / in_progress_count / delayed_count / paused_count / cancelled_count / completion_rate / actual_hours；**由 details 行计算**，summary 与 details 精确对账；completed 使用 actual 状态（六状态） |
| `details` | 每 plan_item 一行（plan_month = 月）：plan_item_id / task_id / l3_code / status / actual_hours |
| `written` / `history` | Member 写入 main_output / problems / next_month_focus / notes；history 不可变（每次修订追加 revision，不覆盖旧值） |
| `meta` | as_of / year / scope / source |

写入契约：Member 本人专属；结构化校验（月份 1-12、字段长度 ≤3000）；`expected_revision` CAS（创建需 0，陈旧 → 409 `monthly_review_revision_conflict`，零部分写入）；校验失败 → 422。

### 3.3 profile.*（scope：本人 / buddy_assigned / leader_team）

| 指标 | 定义 |
|---|---|
| `monthly_reviews` | 该成员当年已写月度复盘 + 不可变 history |
| `provenance` | 有序、可追踪的链：assessment → standard 快照 → plan item → learning task → evidence → Buddy evidence review → monthly review → 后续 assessment 变更；plan item 携带 `source_assessment_id` / `scope_type` / `assessment_revision` / `planning_source_type` / `assessment_scope_version` |
| `meta` | as_of / year / scope / source |

**约束**：任务完成绝不 mutate 或暗示能力等级提升；等级与快照历史保留；legacy/缺失溯源标记（scope_type NULL → legacy fallback）。

## 4. 查询规模约束（已测）

- Member Dashboard：< 30 条语句
- Monthly Review：< 30 条语句（单次 GET 约 5 条）
- Growth Profile：< 20 条语句（batched enrichment，不随计划项数量线性增长）

测试通过 `_CountingConnection` / `_CountingCursor` 计数断言。

## 5. 阶段 2 指标（已定义，未实现）

| 指标 | 状态 |
|---|---|
| `team_analytics.gap_summary` | 团队级 gap 拆分（同一拆分规则，团队分母）— **phase 2** |
| `team_annual_plan.meta` | Team Annual Plan 的 as_of / year / scope / source — **phase 2** |

阶段 2 不在本次（#64 阶段 1）提交范围内，代码未实现，前端未接入。
