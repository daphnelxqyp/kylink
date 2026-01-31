/**
 * 全局类型定义
 */

// 导出联盟链接验证相关类型
export * from './affiliate-verify'

// API 响应基础结构
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

// Lease 请求参数
export interface LeaseRequest {
  campaignId: string
  nowClicks: number
  observedAt: string
  scriptInstanceId: string
  cycleMinutes: number
  windowStartEpochSeconds: number
  idempotencyKey: string
  meta?: CampaignMeta
}

// Lease 响应
export interface LeaseResponse {
  action: 'APPLY' | 'NOOP'
  leaseId?: string
  finalUrlSuffix?: string
  reason?: string
}

// Ack 请求参数
export interface AckRequest {
  leaseId: string
  campaignId: string
  applied: boolean
  appliedAt: string
  errorMessage?: string
}

// Campaign 元数据
export interface CampaignMeta {
  campaignName: string
  country: string
  finalUrl: string
  cid: string
  mccId: string
}

// 错误码枚举
export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PENDING_IMPORT = 'PENDING_IMPORT',
  NO_STOCK = 'NO_STOCK',
  NO_AFFILIATE_LINK = 'NO_AFFILIATE_LINK',
  PROXY_UNAVAILABLE = 'PROXY_UNAVAILABLE',
  REDIRECT_TRACK_FAILED = 'REDIRECT_TRACK_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

