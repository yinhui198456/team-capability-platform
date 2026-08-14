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

export function formatHourValue(value: number) {
  return Number(value.toFixed(10)).toString()
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
    ? `${formatHourValue(parsed.min_hours)}–${formatHourValue(parsed.max_hours)} h`
    : `${formatHourValue(parsed.min_hours)} h`
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
    ? `${formatHourValue(summary.min_hours)} h`
    : `${formatHourValue(summary.min_hours)}–${formatHourValue(summary.max_hours)} h`
}
