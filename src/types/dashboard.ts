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

// ==================== 员工概览模块类型 ====================

/**
 * 最近换链记录项
 */
export interface RecentAssignmentItem {
  id: string
  campaignId: string
  campaignName: string | null
  finalUrlSuffix: string
  assignedAt: string
  writeSuccess: boolean | null
}

/**
 * 员工概览统计响应
 */
export interface EmployeeDashboardStats {
  success: boolean
  /** 广告系列总数 */
  totalCampaigns: number
  /** 今日换链次数 */
  todayAssignments: number
  /** 今日写入成功率（百分比，如 98.5；无数据时为 null） */
  writeSuccessRate: number | null
  /** 今日回传总数 */
  todayWriteTotal: number
  /** 今日写入成功数 */
  todayWriteSuccess: number
  /** 低库存广告系列数 */
  lowStockCampaigns: number
  /** 可用库存总数 */
  stockAvailable: number
  /** 已消耗库存总数 */
  stockConsumed: number
  /** 总观测点击数 */
  totalObservedClicks: number
  /** 已换链点击数 */
  totalAppliedClicks: number
  /** 最近换链记录 Top 10 */
  recentAssignments: RecentAssignmentItem[]
}

