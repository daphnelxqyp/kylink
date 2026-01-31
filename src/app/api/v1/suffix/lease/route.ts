/**
 * POST /v1/suffix/lease
 *
 * 请求换链决策 + 领取 suffix（幂等、可重试）
 *
 * 核心逻辑（PRD 5.2）：
 * 1. delta = nowClicks - lastAppliedClicks
 * 2. delta <= 0 → NOOP
 * 3. delta > 0 且有活跃租约 → 返回同一租约
 * 4. delta > 0 且无活跃租约 → 从库存取 1 条创建租约
 */

import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { processSingleLease } from '@/lib/lease-service'
import {
  parseJsonBody,
  validateRequired,
  successResponse,
  errorResponse,
  validateCycleMinutes,
} from '@/lib/utils'

// 请求体类型
interface LeaseRequest {
  campaignId: string
  nowClicks: number
  observedAt: string
  scriptInstanceId: string
  cycleMinutes: number
  windowStartEpochSeconds: number
  idempotencyKey: string
  meta?: {
    campaignName: string
    country: string
    finalUrl: string
    cid: string
    mccId: string
  }
}

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let body: LeaseRequest | undefined

  try {
    // 1. 鉴权
    const authResult = await authenticateRequest(request)
    if (!authResult.success) {
      return errorResponse(
        authResult.error!.code,
        authResult.error!.message,
        authResult.error!.status
      )
    }
    userId = authResult.userId!

    // 2. 解析请求体
    const { data, error: parseError } = await parseJsonBody<LeaseRequest>(request)
    if (parseError || !data) {
      return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
    }
    body = data

    // 3. 验证必填字段
    const { valid, missing } = validateRequired(data, [
      'campaignId',
      'nowClicks',
      'observedAt',
      'scriptInstanceId',
      'cycleMinutes',
      'windowStartEpochSeconds',
      'idempotencyKey',
    ])
    if (!valid) {
      return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
    }

    // 4. 验证 cycleMinutes 范围
    if (!validateCycleMinutes(data.cycleMinutes)) {
      return errorResponse('VALIDATION_ERROR', 'cycleMinutes 必须在 10-60 之间', 422)
    }

    // 5. 调用 lease-service 处理核心逻辑
    const result = await processSingleLease(userId, {
      campaignId: data.campaignId,
      nowClicks: data.nowClicks,
      observedAt: data.observedAt,
      windowStartEpochSeconds: data.windowStartEpochSeconds,
      idempotencyKey: data.idempotencyKey,
      meta: data.meta,
    })

    // 6. 根据结果返回适当的 HTTP 响应
    // 处理错误情况（有 code 字段表示错误）
    if (result.code) {
      // 根据错误类型返回不同的 HTTP 状态码
      switch (result.code) {
        case 'PENDING_IMPORT':
          return Response.json(
            {
              success: false,
              code: result.code,
              message: result.message,
            },
            { status: 202 }
          )
        case 'NO_STOCK':
          return Response.json(
            {
              success: false,
              code: result.code,
              message: '库存不足，请稍后重试',
            },
            { status: 409 }
          )
        case 'INTERNAL_ERROR':
        default:
          return errorResponse('INTERNAL_ERROR', '服务内部错误，请稍后重试', 500)
      }
    }

    // 7. 返回成功响应
    return successResponse({
      action: result.action,
      leaseId: result.leaseId,
      finalUrlSuffix: result.finalUrlSuffix,
      reason: result.reason,
    })
  } catch (error) {
    const errorContext = {
      userId: userId,
      campaignId: body?.campaignId,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
    console.error('[Lease] Error:', JSON.stringify(errorContext, null, 2))
    return errorResponse('INTERNAL_ERROR', '服务内部错误，请稍后重试', 500)
  }
}

