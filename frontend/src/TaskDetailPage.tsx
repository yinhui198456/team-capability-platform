import { useParams } from 'react-router-dom'
import { AnnualPlanTaskPage } from './AnnualPlanTaskPage'

export function TaskDetailPage() {
  const { taskId } = useParams()
  const id = Number(taskId)
  return Number.isInteger(id) && id > 0 ? (
    <AnnualPlanTaskPage taskId={id} />
  ) : (
    <p className="error">任务不存在。</p>
  )
}
