/**
 * POST /v1/suffix/lease/batch
 * 
 * 批量请求换链决策 + 领取 suffix（PRD 5.2.1）
 * 
 * 核心逻辑：
 * - 每个 campaign 独立判定，互不影响
 * - 部分失败不影响其他 campaign 的结果返回
 * - 单次最多 100 条
 */

import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import {
  processBatchAssignment,
  CampaignAssignmentRequest,
} from '@/lib/assignment-service'
import {
  parseJsonBody,
  validateRequired,
  successResponse,
  errorResponse,
  validateCycleMinutes,
} from '@/lib/utils'

// 批量请求体类型
interface BatchLeaseRequest {
  campaigns: CampaignAssignmentRequest[]
  scriptInstanceId: string
  cycleMinutes: number
}

// 单个 campaign 结果类型
interface CampaignLeaseResult {
  campaignId: string
  action?: 'APPLY' | 'NOOP'
  assignmentId?: string
  finalUrlSuffix?: string
  reason?: string
  code?: string
  message?: string
}

export async function POST(request: NextRequest) {
  // 1. 鉴权
  const authResult = await authenticateRequest(request)
  if (!authResult.success) {
    return errorResponse(
      authResult.error!.code,
      authResult.error!.message,
      authResult.error!.status
    )
  }
  const userId = authResult.userId!

  // 2. 解析请求体
  const { data, error: parseError } = await parseJsonBody<BatchLeaseRequest>(request)
  if (parseError || !data) {
    return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
  }

  // 3. 验证必填字段
  const { valid, missing } = validateRequired(data, [
    'campaigns',
    'scriptInstanceId',
    'cycleMinutes',
  ])
  if (!valid) {
    return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
  }

  // 4. 验证 campaigns 数组
  if (!Array.isArray(data.campaigns)) {
    return errorResponse('VALIDATION_ERROR', 'campaigns 必须是数组', 422)
  }

  if (data.campaigns.length === 0) {
    return errorResponse('VALIDATION_ERROR', 'campaigns 不能为空', 422)
  }

  if (data.campaigns.length > 100) {
    return errorResponse('VALIDATION_ERROR', 'campaigns 单次最多 100 条', 422)
  }

  // 5. 验证 cycleMinutes 范围
  if (!validateCycleMinutes(data.cycleMinutes)) {
    return errorResponse('VALIDATION_ERROR', 'cycleMinutes 必须在 10-60 之间', 422)
  }

  // 6. 验证每个 campaign 的必填字段
  for (const campaign of data.campaigns) {
    const campaignValid = validateRequired(campaign, [
      'campaignId',
      'nowClicks',
      'observedAt',
      'windowStartEpochSeconds',
      'idempotencyKey',
    ])
    if (!campaignValid.valid) {
      return errorResponse(
        'VALIDATION_ERROR',
        `campaign ${campaign.campaignId || 'unknown'} 缺少字段: ${campaignValid.missing.join(', ')}`,
        422
      )
    }
  }

  // 7. 并行处理所有 campaign
  const results: CampaignLeaseResult[] = await processBatchAssignment(userId, data.campaigns)

  // 8. 返回结果
  return successResponse({ results })
}

