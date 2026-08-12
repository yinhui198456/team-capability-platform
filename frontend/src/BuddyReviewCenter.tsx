import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import {
  isMockEnabled,
  mockAssignedMembers,
} from './__fixtures__/buddyReviewMock'
import { useMe } from './catalog'

/**
 * Issue #178: Buddy 工作台不再承担自评复核。
 *
 * Member 自评改为在能力自评/Gap 页面按所选 L3 增量生成学习任务，不再进入
 * 待 Buddy 自评复核队列；Buddy 继续负责 Evidence Review。 本页面保留
 * 辅导成员概览和 Evidence Review 入口。
 */
export function BuddyReviewCenter() {
  const { user } = useMe()

  const members = useMemo(() => {
    if (isMockEnabled()) return mockAssignedMembers
    return (user?.assigned_members ?? []) as {
      id: number
      username: string
      full_name: string
    }[]
  }, [user])

  return (
    <section className="page dashboard-page buddy-review-center">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Buddy 工作台</p>
          <h1>辅导成员看板</h1>
          <p className="muted">
            按负责成员查看学习进展，对成员提交的成果与证据进行验收复核。
          </p>
        </div>
      </header>

      <div className="buddy-review-layout">
        <aside className="dashboard-card buddy-member-list">
          <h2>辅导成员</h2>
          {members.length === 0 ? (
            <p className="muted">暂无辅导成员。</p>
          ) : (
            members.map((member) => (
              <div className="member-row" key={member.id}>
                <strong>{member.full_name}</strong>
                <span className="member-count muted">{member.username}</span>
              </div>
            ))
          )}
        </aside>

        <article className="dashboard-card buddy-evidence-entry">
          <div className="card-heading">
            <h2>待验收成果</h2>
          </div>
          <p className="muted">
            成员在学习任务中提交的成果与证据，由 Buddy 在此验收。
          </p>
          <Link className="primary-link" to="/mentoring/evidence-review">
            前往成果验收
          </Link>
        </article>
      </div>
    </section>
  )
}
