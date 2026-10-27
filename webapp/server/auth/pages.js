/** The report pages a user can be given access to. Ids match the client's. */
export const PAGES = [
  { id: 'daily', label: 'Daily Critical Report' },
  { id: 'summary', label: 'Summary - Critical Inventory' },
  { id: 'comparison', label: 'Comparison Report' },
]

export const PAGE_IDS = PAGES.map((p) => p.id)

export const ROLES = ['admin', 'viewer']
