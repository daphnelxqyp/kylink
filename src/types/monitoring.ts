/**
 * 换链监控模块类型定义
 */

/**
 * Campaign 换链统计
 */
export interface CampaignLinkChangeStat {
  campaignId: string
  campaignName: string | null
  todayClicks: number              // 今日点击数（来自脚本上报）
  todayAssignments: number         // 今日换链次数
  successCount: number             // 成功次数
  failureCount: number             // 失败次数
  successRate: number | null       // 成功率（今日无换链时为 null）
  lastAssignedAt: Date | null      // 最后换链时间（历史）
  lastMonitoredAt: Date | null     // 最后监控时间
}

/**
 * 全局汇总统计
 */
export interface LinkChangeSummary {
  totalCampaigns: number       // 总广告系列数
  totalClicks: number          // 今日总点击数
  totalAssignments: number     // 今日总换链次数
  totalSuccess: number         // 今日总成功次数
  successRate: number          // 今日成功率（百分比）
}

/**
 * 换链监控响应数据
 */
export interface LinkChangeMonitoringData {
  summary: LinkChangeSummary
  campaigns: CampaignLinkChangeStat[]
}

/**
 * API 响应格式
 */
export interface LinkChangeMonitoringResponse {
  success: true
  data: LinkChangeMonitoringData
}
