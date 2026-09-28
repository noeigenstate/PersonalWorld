import type { PlaceRole } from '../types'

// Names as the interface says them. No imports, so Node can load this straight from TypeScript in tests.

export function cityLabel(city: string) {
  return city.replace(/(市|特别行政区)$/, '')
}

export const roleLabels: Record<PlaceRole, string> = {
  home: '老家',
  study: '求学',
  work: '工作',
  residence: '居住',
  travel: '旅行',
}
