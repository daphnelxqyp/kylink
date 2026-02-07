/**
 * 前端 API 客户端（浏览器端）
 * 统一处理鉴权头、错误解析与本地配置存储
 *
 * 多用户隔离：localStorage 键名按用户 email 隔离，
 * 不同用户登录同一浏览器不会互相读到对方的配置。
 */

/** localStorage 基础键名（实际存储时会附加 @userEmail 后缀） */
export const STORAGE_KEYS = {
  API_KEY: 'kyads_api_key',
  SPREADSHEET_ID: 'kyads_spreadsheet_id',
  SPREADSHEET_CONFIGS: 'kyads_spreadsheet_configs',
  AFFILIATE_API_CONFIGS: 'kyads_affiliate_api_configs',
} as const

/** 当前登录用户标记的 localStorage 键名（不加用户后缀） */
const CURRENT_USER_KEY = 'kyads_current_user'

/**
 * Spreadsheet 配置项类型
 * 包含 MCC 名称和对应的 Spreadsheet URL
 */
export interface SpreadsheetConfig {
  mccName: string
  url: string
}

/**
 * 联盟链接 API 配置项类型
 * 包含联盟简称和对应的 API 密钥
 */
export interface AffiliateApiConfig {
  /** 联盟简称（如：Amazon、eBay） */
  name: string
  /** 联盟 API 密钥 */
  apiKey: string
}

export const CONFIG_UPDATED_EVENT = 'kyads-config-updated'

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

// ─── 多用户隔离 ────────────────────────────────────────────

/**
 * 获取当前登录用户（email）
 */
export function getCurrentUser(): string | null {
  if (!isBrowser()) return null
  return window.localStorage.getItem(CURRENT_USER_KEY)
}

/**
 * 设置当前登录用户。
 * 首次调用时会自动将旧的未隔离数据迁移到该用户名下。
 *
 * @param email - 当前登录用户的 email
 */
export function setCurrentUser(email: string): void {
  if (!isBrowser()) return
  const prev = window.localStorage.getItem(CURRENT_USER_KEY)
  if (prev === email) return // 无变化

  // 首次迁移：旧数据（未加用户后缀）迁移到第一个登录用户名下
  if (!prev) {
    migrateOldStorageKeys(email)
  }

  window.localStorage.setItem(CURRENT_USER_KEY, email)
  notifyConfigUpdated()
}

/**
 * 清除当前用户标记（一般不需要，登出后下次登录会自动覆盖）
 */
export function clearCurrentUser(): void {
  if (!isBrowser()) return
  window.localStorage.removeItem(CURRENT_USER_KEY)
}

/**
 * 获取用户隔离后的 localStorage 键名
 * 格式：baseKey@userEmail（如 kyads_api_key@xc01@kyads.net）
 */
function getUserScopedKey(baseKey: string): string {
  const user = getCurrentUser()
  return user ? `${baseKey}@${user}` : baseKey
}

/**
 * 将旧的未隔离 localStorage 数据迁移到指定用户名下。
 * 仅在首次设置 CURRENT_USER_KEY 时执行一次。
 */
function migrateOldStorageKeys(email: string): void {
  const keysToMigrate = [
    STORAGE_KEYS.API_KEY,
    STORAGE_KEYS.SPREADSHEET_ID,
    STORAGE_KEYS.SPREADSHEET_CONFIGS,
    STORAGE_KEYS.AFFILIATE_API_CONFIGS,
  ]
  for (const key of keysToMigrate) {
    const value = window.localStorage.getItem(key)
    if (value !== null) {
      const scopedKey = `${key}@${email}`
      // 只在目标键不存在时迁移，避免覆盖已有数据
      if (window.localStorage.getItem(scopedKey) === null) {
        window.localStorage.setItem(scopedKey, value)
      }
      // 删除旧键
      window.localStorage.removeItem(key)
    }
  }
}

// ─── API Key 存储 ──────────────────────────────────────────

export function getStoredApiKey(): string | null {
  if (!isBrowser()) return null
  return window.localStorage.getItem(getUserScopedKey(STORAGE_KEYS.API_KEY))
}

export function setStoredApiKey(value: string): void {
  if (!isBrowser()) return
  window.localStorage.setItem(getUserScopedKey(STORAGE_KEYS.API_KEY), value)
  notifyConfigUpdated()
}

export function clearStoredApiKey(): void {
  if (!isBrowser()) return
  window.localStorage.removeItem(getUserScopedKey(STORAGE_KEYS.API_KEY))
  notifyConfigUpdated()
}

export function getStoredSpreadsheetIds(): string[] {
  if (!isBrowser()) return []
  const stored = window.localStorage.getItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_ID))
  if (!stored) return []
  try {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed)) {
      return parsed.map(value => String(value).trim()).filter(Boolean)
    }
    if (typeof parsed === 'string') {
      return parsed.trim() ? [parsed.trim()] : []
    }
  } catch {
    // ignore JSON parse error
  }
  return stored.trim() ? [stored.trim()] : []
}

export function setStoredSpreadsheetIds(values: string[]): void {
  if (!isBrowser()) return
  const normalized = values.map(value => value.trim()).filter(Boolean)
  if (!normalized.length) {
    window.localStorage.removeItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_ID))
    notifyConfigUpdated()
    return
  }
  window.localStorage.setItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_ID), JSON.stringify(normalized))
  notifyConfigUpdated()
}

export function clearStoredSpreadsheetIds(): void {
  if (!isBrowser()) return
  window.localStorage.removeItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_ID))
  notifyConfigUpdated()
}

/**
 * 获取存储的 Spreadsheet 配置列表（包含 MCC 名称和 URL）
 */
export function getStoredSpreadsheetConfigs(): SpreadsheetConfig[] {
  if (!isBrowser()) return []
  const stored = window.localStorage.getItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_CONFIGS))
  if (!stored) {
    // 兼容旧数据：尝试从旧的 spreadsheetIds 迁移
    const oldIds = getStoredSpreadsheetIds()
    if (oldIds.length) {
      return oldIds.map(url => ({ mccName: '', url }))
    }
    return []
  }
  try {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is SpreadsheetConfig =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.url === 'string'
      )
    }
  } catch {
    // ignore JSON parse error
  }
  return []
}

/**
 * 存储 Spreadsheet 配置列表
 */
export function setStoredSpreadsheetConfigs(configs: SpreadsheetConfig[]): void {
  if (!isBrowser()) return
  // 过滤掉 URL 为空的配置
  const normalized = configs
    .map(c => ({ mccName: (c.mccName || '').trim(), url: (c.url || '').trim() }))
    .filter(c => c.url)
  if (!normalized.length) {
    window.localStorage.removeItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_CONFIGS))
    window.localStorage.removeItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_ID))
    notifyConfigUpdated()
    return
  }
  window.localStorage.setItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_CONFIGS), JSON.stringify(normalized))
  // 同步更新旧的 spreadsheetIds（向后兼容）
  const urls = normalized.map(c => c.url)
  window.localStorage.setItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_ID), JSON.stringify(urls))
  notifyConfigUpdated()
}

/**
 * 清除存储的 Spreadsheet 配置
 */
export function clearStoredSpreadsheetConfigs(): void {
  if (!isBrowser()) return
  window.localStorage.removeItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_CONFIGS))
  window.localStorage.removeItem(getUserScopedKey(STORAGE_KEYS.SPREADSHEET_ID))
  notifyConfigUpdated()
}

/**
 * 获取存储的联盟链接 API 配置列表
 */
export function getStoredAffiliateApiConfigs(): AffiliateApiConfig[] {
  if (!isBrowser()) return []
  const stored = window.localStorage.getItem(getUserScopedKey(STORAGE_KEYS.AFFILIATE_API_CONFIGS))
  if (!stored) return []
  try {
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is AffiliateApiConfig =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.name === 'string' &&
          typeof item.apiKey === 'string'
      )
    }
  } catch {
    // ignore JSON parse error
  }
  return []
}

/**
 * 存储联盟链接 API 配置列表
 */
export function setStoredAffiliateApiConfigs(configs: AffiliateApiConfig[]): void {
  if (!isBrowser()) return
  // 过滤掉名称或密钥为空的配置，并去重（根据名称）
  const configsMap = new Map<string, AffiliateApiConfig>()
  configs.forEach(c => {
    const name = (c.name || '').trim()
    const apiKey = (c.apiKey || '').trim()
    if (name && apiKey && !configsMap.has(name)) {
      configsMap.set(name, { name, apiKey })
    }
  })
  const normalized = Array.from(configsMap.values())
  if (!normalized.length) {
    window.localStorage.removeItem(getUserScopedKey(STORAGE_KEYS.AFFILIATE_API_CONFIGS))
    notifyConfigUpdated()
    return
  }
  window.localStorage.setItem(getUserScopedKey(STORAGE_KEYS.AFFILIATE_API_CONFIGS), JSON.stringify(normalized))
  notifyConfigUpdated()
}

/**
 * 清除存储的联盟链接 API 配置
 */
export function clearStoredAffiliateApiConfigs(): void {
  if (!isBrowser()) return
  window.localStorage.removeItem(getUserScopedKey(STORAGE_KEYS.AFFILIATE_API_CONFIGS))
  notifyConfigUpdated()
}

export function notifyConfigUpdated(): void {
  if (!isBrowser()) return
  window.dispatchEvent(new Event(CONFIG_UPDATED_EVENT))
}

export function isValidApiKey(apiKey: string): boolean {
  const hasValidPrefix = apiKey.startsWith('ky_live_') || apiKey.startsWith('ky_test_')
  return hasValidPrefix && apiKey.length === 40
}

export function getApiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12)
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok || data?.success === false) {
    // 支持两种错误格式：
    // 1. { error: "错误信息" } - 字符串格式
    // 2. { error: { message: "错误信息" } } - 对象格式
    const errorField = data?.error
    const message = typeof errorField === 'string' 
      ? errorField 
      : (errorField?.message || '请求失败，请稍后重试')
    throw new Error(message)
  }
  return data as T
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { requireAuth?: boolean } = {}
): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || ''
  const url = `${baseUrl}${path}`
  const headers = new Headers(options.headers || {})

  const requireAuth = options.requireAuth !== false
  if (requireAuth) {
    const apiKey = getStoredApiKey()
    if (!apiKey) {
      throw new Error('请先在设置页配置 API Key')
    }
    headers.set('Authorization', `Bearer ${apiKey}`)
  }

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  return parseResponse<T>(response)
}

export function getJson<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'GET' })
}

export function postJson<T>(path: string, payload: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getJsonPublic<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'GET', requireAuth: false })
}

export function postJsonPublic<T>(path: string, payload: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
    requireAuth: false,
  })
}

export function putJsonPublic<T>(path: string, payload: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'PUT',
    body: JSON.stringify(payload),
    requireAuth: false,
  })
}

export function patchJsonPublic<T>(path: string, payload: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    requireAuth: false,
  })
}

export function deleteJsonPublic<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'DELETE', requireAuth: false })
}

