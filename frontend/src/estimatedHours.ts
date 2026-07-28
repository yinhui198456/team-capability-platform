export type EstimatedHours = {
  raw: string | null
  min_hours: number | null
  max_hours: number | null
  is_valid: boolean
  is_range: boolean
}

export type EstimatedHoursSummary = {
  min_hours: number | null
  max_hours: number | null
  has_values: boolean
  has_unparsed: boolean
}

function number(value: number) {
  return Number.isInteger(value) ? String(value) : String(value)
}

export function formatEstimatedHours(
  raw: string | null | undefined,
  parsed?: EstimatedHours | null,
): string {
  if (!raw?.trim()) return '暂未填写'
  if (
    !parsed?.is_valid ||
    parsed.min_hours == null ||
    parsed.max_hours == null
  ) {
    return raw.trim()
  }
  return parsed.is_range
    ? `${number(parsed.min_hours)}–${number(parsed.max_hours)} h`
    : `${number(parsed.min_hours)} h`
}

export function formatEstimatedHoursSummary(
  summary?: EstimatedHoursSummary | null,
): string {
  if (
    !summary?.has_values ||
    summary.min_hours == null ||
    summary.max_hours == null
  ) {
    return '暂未填写'
  }
  return summary.min_hours === summary.max_hours
    ? `${number(summary.min_hours)} h`
    : `${number(summary.min_hours)}–${number(summary.max_hours)} h`
}
