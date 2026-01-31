/**
 * Spreadsheet URL 处理工具
 * - 支持单个字符串、数组、JSON 字符串
 * - 去重、去空、统一 trim
 */

export function normalizeSpreadsheetIds(input: unknown): string[] {
  const rawList: string[] = []

  if (Array.isArray(input)) {
    for (const item of input) {
      rawList.push(String(item))
    }
  } else if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) {
      return []
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          rawList.push(String(item))
        }
      } else if (typeof parsed === 'string') {
        rawList.push(parsed)
      } else {
        rawList.push(trimmed)
      }
    } catch {
      rawList.push(trimmed)
    }
  }

  const normalized = rawList
    .map(value => value.trim())
    .filter(Boolean)

  return Array.from(new Set(normalized))
}

export function serializeSpreadsheetIds(input: unknown): string | null {
  const ids = normalizeSpreadsheetIds(input)
  if (!ids.length) return null
  return JSON.stringify(ids)
}

export function parseSpreadsheetIds(value?: string | null): string[] {
  if (!value) return []
  return normalizeSpreadsheetIds(value)
}

