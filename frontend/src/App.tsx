import { useEffect, type ReactNode } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import { useMe } from './catalog'
import { defaultRouteFor } from './access'
import { YearProvider } from './YearContext'
import { Layout } from './Layout'
import { LoginPage } from './LoginPage'
import { MemberDashboardPage } from './MemberDashboardPage'
import { AssessmentGapPage } from './AssessmentGapPage'
import { AssessmentHistoryPage } from './AssessmentHistoryPage'
import { AnnualPlanTimelinePage } from './AnnualPlanTimelinePage'
import { TaskListPage } from './TaskListPage'
import { TaskDetailPage } from './TaskDetailPage'
import { ProfilePage } from './ProfilePage'
import { MonthlyReviewPage } from './MonthlyReviewPage'
import { EvidenceReviewPage } from './EvidenceReviewPage'
import { CapabilityModelPage } from './CapabilityModelPage'
import { CapabilityStandardVersionsPage } from './CapabilityStandardVersionsPage'
import { LearningResourcesPage } from './LearningResourcesPage'
import { TeamAnalyticsPage } from './TeamAnalyticsPage'
import { TeamAnnualPlanPage } from './TeamAnnualPlanPage'
import { SystemAdminPage } from './SystemAdminPage'

function DefaultRoute() {
  const navigate = useNavigate()
  const { user, loading } = useMe()

  useEffect(() => {
    if (loading) return
    const target = user ? defaultRouteFor(user.roles) : '/login'
    navigate(target, { replace: true })
  }, [loading, user, navigate])

  return <p className="muted">正在加载…</p>
}

function AuthenticatedShell() {
  const { user, loading } = useAuth()
  if (loading) {
    return <p className="muted">正在加载…</p>
  }
  if (!user) {
    return <Navigate to="/login" replace />
  }
  return (
    <YearProvider>
      <Layout />
    </YearProvider>
  )
}

// Only valid inside AuthenticatedShell, which guarantees an authenticated
// user; this guard enforces the Buddy-only boundary of the evidence page.
function RequireBuddy({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!user?.roles.includes('Buddy')) {
    return <Navigate to={defaultRouteFor(user?.roles ?? [])} replace />
  }
  return children
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Legacy redirects */}
        <Route
          path="/mentoring/assessment-review"
          element={<Navigate to="/mentoring/dashboard" replace />}
        />
        <Route
          path="/capability/gap"
          element={<Navigate to="/capability/assessment" replace />}
        />

        {/* Authenticated app shell: auth gate + YearProvider remounts after login */}
        <Route element={<AuthenticatedShell />}>
          <Route path="/dashboard/member" element={<MemberDashboardPage />} />
          <Route path="/capability/model" element={<CapabilityModelPage />} />
          <Route
            path="/capability/standards"
            element={<CapabilityStandardVersionsPage />}
          />
          <Route
            path="/capability/assessment"
            element={<AssessmentGapPage />}
          />
          <Route
            path="/capability/assessment/history"
            element={<AssessmentHistoryPage />}
          />
          <Route
            path="/growth/goals"
            element={<Navigate to="/growth/annual-plan" replace />}
          />
          <Route
            path="/growth/annual-plan"
            element={<AnnualPlanTimelinePage />}
          />
          <Route path="/growth/tasks" element={<TaskListPage />} />
          <Route path="/growth/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/growth/profile" element={<ProfilePage />} />
          <Route
            path="/growth/review/monthly"
            element={<MonthlyReviewPage />}
          />
          <Route
            path="/mentoring/dashboard"
            element={<Navigate to="/mentoring/evidence-review" replace />}
          />
          <Route
            path="/mentoring/evidence-review"
            element={
              <RequireBuddy>
                <EvidenceReviewPage />
              </RequireBuddy>
            }
          />
          <Route
            path="/operations/resources"
            element={<LearningResourcesPage />}
          />
          <Route path="/operations/analytics" element={<TeamAnalyticsPage />} />
          <Route
            path="/operations/team-annual-plan"
            element={<TeamAnnualPlanPage />}
          />
          <Route path="/system/users" element={<SystemAdminPage />} />

          {/* Default: role-aware redirect */}
          <Route path="*" element={<DefaultRoute />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}
