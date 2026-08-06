"""v0014: backfill evidence archival for historically-completed tasks.

Issue #65 commit ef404a5 added atomic evidence archiving (通过 → 已归档)
when a task transitions to 已完成.  Databases that already had completed
tasks with 通过 evidence before that commit will never re-trigger the
transition, leaving Member/Buddy/Profile/analytics views inconsistent
(已归档 counter stays zero for legitimate historical records).

This migration is a pure forward data alignment:
  UPDATE evidence SET status = '已归档'
  WHERE learning_task_id IN (SELECT id FROM learning_task WHERE status = '已完成')
    AND status = '通过'

Non-completed tasks (进行中/延期/未开始/暂停/取消) and non-通过 evidence
(草稿/待 Review/需补充/驳回/已归档) are untouched.  Re-running is a no-op
because the WHERE clause excludes already-archived rows.
"""

import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        UPDATE evidence
        SET status = '已归档'
        WHERE learning_task_id IN (
            SELECT id FROM learning_task WHERE status = '已完成'
        )
          AND status = '通过'
        """
    )
