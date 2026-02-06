/**
 * 前端管理界面相关类型
 */

export interface StockCampaignStat {
  userId: string
  campaignId: string
  campaignName: string | null
  available: number
  leased: number
  consumed: number
  total: number
  needsReplenish: boolean
}

export interface StockSummary {
  totalCampaigns: number
  lowStockCampaigns: number
  totalAvailable: number
  totalLeased: number
  totalConsumed: number
}

export interface StockStatsResponse {
  success: boolean
  campaigns: StockCampaignStat[]
  summary: StockSummary
}

export type AlertLevel = 'info' | 'warning' | 'critical'
export type AlertType =
  | 'low_stock'
  | 'high_failure_rate'
  | 'no_stock_frequent'
  | 'system_health'

export interface AlertItem {
  id: string
  type: AlertType
  level: AlertLevel
  title: string
  message: string
  metadata?: Record<string, unknown>
  createdAt: string
  acknowledged: boolean
  acknowledgedAt?: string
}

export interface AlertStats {
  total: number
  unacknowledged: number
  byLevel: Record<AlertLevel, number>
  byType: Record<AlertType, number>
}

export interface AlertPagination {
  limit: number
  offset: number
  hasMore: boolean
}

export interface AlertResponse {
  success: boolean
  history: AlertItem[]
  stats: AlertStats
  pagination?: AlertPagination
}

export interface JobItem {
  name: string
  description: string
  intervalMinutes: number
  enabled: boolean
  lastRun?: string
  nextRun?: string
}

export interface JobHistoryItem {
  jobName: string
  startedAt: string
  completedAt: string
  duration: number
  success: boolean
  result?: unknown
  error?: string
}

export interface JobStatusResponse {
  success: boolean
  jobs: JobItem[]
  history: JobHistoryItem[]
}

export type UserStatus = 'active' | 'suspended'
export type UserRole = 'ADMIN' | 'USER'

export interface AdminUserItem {
  id: string
  email: string | null
  name: string | null
  status: UserStatus
  role: UserRole
  apiKeyPrefix: string
  apiKeyCreatedAt: string | null
  spreadsheetIds: string[]
  createdAt: string
  updatedAt: string
}

export interface AdminUserListResponse {
  success: boolean
  users: AdminUserItem[]
  total: number
}

export interface ProxyProviderAssignedUser {
  id: string
  email: string | null
  name: string | null
}

export interface AdminProxyProviderItem {
  id: string
  name: string
  priority: number
  host: string
  port: number
  usernameTemplate: string | null
  enabled: boolean
  assignedUserId: string | null
  assignedUser: ProxyProviderAssignedUser | null
  // 多用户分配
  assignedUsers?: ProxyProviderAssignedUser[]
  createdAt: string
  updatedAt: string
}

export interface AdminProxyProviderListResponse {
  success: boolean
  providers: AdminProxyProviderItem[]
  total: number
}

// ==================== 链接管理模块类型 ====================

/**
 * 广告系列元数据
 */
export interface CampaignItem {
  id: string
  userId: string
  campaignId: string
  campaignName: string | null
  country: string | null
  finalUrl: string | null
  cid: string
  mccId: string
  status: 'active' | 'inactive'
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
  // 关联统计
  affiliateLinkCount: number
  stockCount: number
  // 联盟链接详情（优先级最高的一条）
  affiliateLinkId: string | null
  affiliateLinkUrl: string | null
  affiliateLinkEnabled: boolean | null
}

/**
 * 联盟链接项
 */
export interface AffiliateLinkItem {
  id: string
  userId: string
  campaignId: string
  url: string
  enabled: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

/**
 * 广告系列列表响应
 */
export interface CampaignListResponse {
  success: boolean
  campaigns: CampaignItem[]
  total: number
}

/**
 * 联盟链接列表响应
 */
export interface AffiliateLinkListResponse {
  success: boolean
  links: AffiliateLinkItem[]
  total: number
}

/**
 * 联盟链接操作响应
 */
export interface AffiliateLinkActionResponse {
  success: boolean
  link?: AffiliateLinkItem
  message?: string
}

