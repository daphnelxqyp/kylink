/**
 * POST /v1/suffix/ack
 *
 * 回执写入结果，驱动租约与 clicks 状态推进
 *
 * 核心逻辑（PRD 5.3）：
 * - ack 必须幂等：重复 ack 不得改变最终结果
 * - applied=true：租约标记为 consumed，更新 lastAppliedClicks
 * - applied=false：租约标记为 failed，立即释放库存回可用池
 */

import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { processSingleAck, SingleAckRequest } from '@/lib/lease-service'
import {
  parseJsonBody,
  validateRequired,
  successResponse,
  errorResponse,
} from '@/lib/utils'

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let body: SingleAckRequest | undefined

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
    const { data, error: parseError } = await parseJsonBody<SingleAckRequest>(request)
    if (parseError || !data) {
      return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
    }
    body = data

    // 3. 验证必填字段
    const { valid, missing } = validateRequired(data, [
      'leaseId',
      'campaignId',
      'applied',
      'appliedAt',
    ])
    if (!valid) {
      return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
    }

    // 4. 调用服务层处理 ack
    const result = await processSingleAck(userId, data)

    // 5. 转换结果为 HTTP 响应
    if (!result.ok) {
      // 租约不存在或处理失败
      const statusCode = result.message === '租约不存在或无权访问' ? 404 : 500
      return errorResponse('VALIDATION_ERROR', result.message || '处理失败', statusCode)
    }

    // 6. 返回成功响应
    // 保持与原 API 响应格式兼容
    if (result.previousStatus) {
      // 幂等情况：租约已处理
      return successResponse({
        ok: true,
        message: result.message,
        previousStatus: result.previousStatus,
      })
    }

    // 正常处理成功
    return successResponse({
      ok: true,
      status: data.applied ? 'consumed' : 'failed',
    })
  } catch (error) {
    const errorContext = {
      userId: userId,
      campaignId: body?.campaignId,
      leaseId: body?.leaseId,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
    console.error('[Ack] Error:', JSON.stringify(errorContext, null, 2))
    return errorResponse('INTERNAL_ERROR', '服务内部错误，请稍后重试', 500)
  }
}

