/**
 * Zod 验证 Schema 定义
 *
 * 统一的请求验证模块，提供类型安全的输入验证
 */

import { z } from 'zod'
import { BATCH_CONFIG } from './utils'

// ============================================
// 通用 Schema
// ============================================

/**
 * UUID 格式验证
 */
export const uuidSchema = z.string().uuid('无效的 UUID 格式')

/**
 * 邮箱格式验证
 */
export const emailSchema = z.string().email('邮箱格式不正确')

/**
 * URL 格式验证
 */
export const urlSchema = z.string().url('URL 格式不正确')

/**
 * 非空字符串
 */
export const nonEmptyString = z.string().min(1, '不能为空')

/**
 * 国家代码（2-3 位字母）
 */
export const countryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2,3}$/i, '国家代码必须是 2-3 位字母')
  .transform(s => s.toUpperCase())

/**
 * 端口号
 */
export const portSchema = z
  .number()
  .int('端口号必须是整数')
  .min(1, '端口号最小为 1')
  .max(65535, '端口号最大为 65535')

// ============================================
// Lease API Schema
// ============================================

/**
 * Campaign Meta 信息
 */
export const campaignMetaSchema = z.object({
  campaignName: nonEmptyString,
  country: nonEmptyString,
  finalUrl: urlSchema,
  cid: nonEmptyString,
  mccId: nonEmptyString,
})

/**
 * 单个 Campaign Lease 请求
 */
export const singleLeaseRequestSchema = z.object({
  campaignId: nonEmptyString,
  nowClicks: z.number().int().min(0, '点击数不能为负'),
  observedAt: z.string().datetime({ message: '观测时间格式不正确' }).or(z.string()),
  windowStartEpochSeconds: z.number().int().positive('窗口开始时间必须为正整数'),
  idempotencyKey: nonEmptyString,
  meta: campaignMetaSchema.optional(),
})

/**
 * 单条 Lease 请求
 */
export const leaseRequestSchema = z.object({
  campaignId: nonEmptyString,
  nowClicks: z.number().int().min(0),
  observedAt: z.string(),
  windowStartEpochSeconds: z.number().int().positive(),
  idempotencyKey: nonEmptyString,
  scriptInstanceId: nonEmptyString,
  cycleMinutes: z.number().int().min(10).max(60),
  meta: campaignMetaSchema.optional(),
})

/**
 * 批量 Lease 请求
 */
export const batchLeaseRequestSchema = z.object({
  campaigns: z
    .array(singleLeaseRequestSchema)
    .min(1, 'campaigns 不能为空')
    .max(BATCH_CONFIG.MAX_BATCH_SIZE, `campaigns 单次最多 ${BATCH_CONFIG.MAX_BATCH_SIZE} 条`),
  scriptInstanceId: nonEmptyString,
  cycleMinutes: z.number().int().min(10).max(60),
})

/**
 * 单个 Ack 请求
 */
export const singleAckRequestSchema = z.object({
  leaseId: nonEmptyString,
  campaignId: nonEmptyString,
  applied: z.boolean(),
  appliedAt: z.string(),
  errorMessage: z.string().optional(),
})

/**
 * 批量 Ack 请求
 */
export const batchAckRequestSchema = z.object({
  acks: z
    .array(singleAckRequestSchema)
    .min(1, 'acks 不能为空')
    .max(BATCH_CONFIG.MAX_BATCH_SIZE, `acks 单次最多 ${BATCH_CONFIG.MAX_BATCH_SIZE} 条`),
})

// ============================================
// User API Schema
// ============================================

/**
 * 创建用户请求
 */
export const createUserSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, '密码至少需要 8 位'),
  name: z.string().optional(),
})

/**
 * 更新用户请求
 */
export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  password: z.string().min(8).optional(),
  name: z.string().optional(),
  status: z.enum(['active', 'suspended']).optional(),
})

// ============================================
// Proxy Provider API Schema
// ============================================

/**
 * 创建代理供应商请求
 */
export const createProxyProviderSchema = z.object({
  name: nonEmptyString,
  priority: z.number().int().min(0).default(0),
  host: nonEmptyString,
  port: portSchema,
  usernameTemplate: nonEmptyString,
  password: z.string().optional(),
  enabled: z.boolean().default(true),
})

/**
 * 更新代理供应商请求
 */
export const updateProxyProviderSchema = z.object({
  name: nonEmptyString,
  priority: z.number().int().min(0).optional(),
  host: nonEmptyString,
  port: portSchema,
  usernameTemplate: nonEmptyString,
  password: z.string().optional(),
  enabled: z.boolean().optional(),
})

// ============================================
// Affiliate Link API Schema
// ============================================

/**
 * 创建联盟链接请求
 */
export const createAffiliateLinkSchema = z.object({
  userId: nonEmptyString,
  campaignId: nonEmptyString,
  url: urlSchema,
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).default(0),
})

/**
 * 更新联盟链接请求
 */
export const updateAffiliateLinkSchema = z.object({
  url: urlSchema.optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
})

// ============================================
// Affiliate Verify API Schema
// ============================================

/**
 * 联盟链接验证请求
 */
export const affiliateVerifyRequestSchema = z.object({
  affiliateLink: urlSchema,
  countryCode: countryCodeSchema,
  targetDomain: z.string().optional(),
  referrer: z.string().optional(),
  campaignId: z.string().optional(),
  userId: z.string().optional(),
  maxRedirects: z.number().int().min(1).max(30).default(10),
})

// ============================================
// Campaign API Schema
// ============================================

/**
 * Campaign 同步请求中的单个 Campaign
 */
export const syncCampaignItemSchema = z.object({
  campaignId: nonEmptyString,
  campaignName: z.string().optional(),
  country: z.string().optional(),
  finalUrl: z.string().optional(),
  cid: z.string().optional(),
  mccId: z.string().optional(),
  status: z.enum(['active', 'paused', 'removed']).optional(),
})

/**
 * Campaign 同步请求
 */
export const campaignSyncRequestSchema = z.object({
  campaigns: z.array(syncCampaignItemSchema).min(1),
  syncMode: z.enum(['full', 'incremental']),
})

// ============================================
// 验证工具函数
// ============================================

import { ValidationError } from './errors'

/**
 * 验证请求数据并返回类型安全的结果
 *
 * @throws ValidationError 验证失败时抛出
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): T {
  const result = schema.safeParse(data)

  if (!result.success) {
    const errors = result.error.issues.map(e => ({
      path: e.path.join('.'),
      message: e.message,
    }))

    throw new ValidationError(
      errors.map(e => `${e.path}: ${e.message}`).join('; '),
      { errors }
    )
  }

  return result.data
}

/**
 * 安全验证（不抛出异常）
 */
export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string; errors: Array<{ path: string; message: string }> } {
  const result = schema.safeParse(data)

  if (!result.success) {
    const errors = result.error.issues.map(e => ({
      path: e.path.join('.'),
      message: e.message,
    }))

    return {
      success: false,
      error: errors.map(e => `${e.path}: ${e.message}`).join('; '),
      errors,
    }
  }

  return { success: true, data: result.data }
}

// ============================================
// 类型导出
// ============================================

export type LeaseRequest = z.infer<typeof leaseRequestSchema>
export type BatchLeaseRequest = z.infer<typeof batchLeaseRequestSchema>
export type SingleAckRequest = z.infer<typeof singleAckRequestSchema>
export type BatchAckRequest = z.infer<typeof batchAckRequestSchema>
export type CreateUserRequest = z.infer<typeof createUserSchema>
export type UpdateUserRequest = z.infer<typeof updateUserSchema>
export type CreateProxyProviderRequest = z.infer<typeof createProxyProviderSchema>
export type UpdateProxyProviderRequest = z.infer<typeof updateProxyProviderSchema>
export type CreateAffiliateLinkRequest = z.infer<typeof createAffiliateLinkSchema>
export type UpdateAffiliateLinkRequest = z.infer<typeof updateAffiliateLinkSchema>
export type AffiliateVerifyRequest = z.infer<typeof affiliateVerifyRequestSchema>
export type CampaignSyncRequest = z.infer<typeof campaignSyncRequestSchema>
