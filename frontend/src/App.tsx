import { Routes, Route, Navigate } from 'react-router-dom'
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

export function App() {
  return (
    <YearProvider>
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

      {/* App shell with sidebar */}
      <Route element={<Layout />}>
        <Route path="/dashboard/member" element={<MemberDashboardPage />} />
        <Route path="/capability/model" element={<CapabilityModelPage />} />
        <Route path="/capability/assessment" element={<AssessmentGapPage />} />
        <Route
          path="/capability/assessment/history"
          element={<AssessmentHistoryPage />}
        />
        <Route path="/growth/goals" element={<GrowthGoalPage />} />
        <Route path="/growth/annual-plan" element={<AnnualPlanTaskPage />} />
        <Route path="/growth/profile" element={<ProfilePage />} />
        <Route path="/growth/review/monthly" element={<MonthlyReviewPage />} />
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

        {/* Default */}
        <Route path="*" element={<Navigate to="/dashboard/member" replace />} />
      </Route>
    </Routes>
    </YearProvider>
  )
}
