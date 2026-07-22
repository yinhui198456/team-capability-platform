import { useEffect } from 'react'
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
import { GrowthGoalPage } from './GrowthGoalPage'
import { AnnualPlanTaskPage } from './AnnualPlanTaskPage'
import { ProfilePage } from './ProfilePage'
import { MonthlyReviewPage } from './MonthlyReviewPage'
import { BuddyReviewCenter } from './BuddyReviewCenter'
import { CapabilityModelPage } from './CapabilityModelPage'
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

export function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Legacy redirects */}
        <Route
          path="/growth/tasks"
          element={<Navigate to="/growth/annual-plan" replace />}
        />
        <Route
          path="/mentoring/assessment-review"
          element={<Navigate to="/mentoring/dashboard" replace />}
        />
        <Route
          path="/mentoring/evidence-review"
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
            path="/capability/assessment"
            element={<AssessmentGapPage />}
          />
          <Route
            path="/capability/assessment/history"
            element={<AssessmentHistoryPage />}
          />
          <Route path="/growth/goals" element={<GrowthGoalPage />} />
          <Route path="/growth/annual-plan" element={<AnnualPlanTaskPage />} />
          <Route path="/growth/profile" element={<ProfilePage />} />
          <Route
            path="/growth/review/monthly"
            element={<MonthlyReviewPage />}
          />
          <Route path="/mentoring/dashboard" element={<BuddyReviewCenter />} />
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
