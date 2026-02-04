/**
 * POST /v1/suffix/report
 *
 * 回传写入结果，记录日志
 *
 * 核心逻辑：
 * - 仅记录写入结果日志，不改变库存状态
 * - 支持幂等：重复回传不会重复记录
 */

import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { processSingleReport, SingleReportRequest } from '@/lib/assignment-service'
import {
  parseJsonBody,
  validateRequired,
  successResponse,
  errorResponse,
} from '@/lib/utils'

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let body: SingleReportRequest | undefined

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
    const { data, error: parseError } = await parseJsonBody<SingleReportRequest>(request)
    if (parseError || !data) {
      return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
    }
    body = data

    // 3. 验证必填字段
    const { valid, missing } = validateRequired(data, [
      'assignmentId',
      'campaignId',
      'writeSuccess',
      'reportedAt',
    ])
    if (!valid) {
      return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
    }

    // 4. 调用服务层处理 report
    const result = await processSingleReport(userId, data)

    // 5. 转换结果为 HTTP 响应
    if (!result.ok) {
      // 分配记录不存在或处理失败
      const statusCode = result.message === '分配记录不存在或无权访问' ? 404 : 500
      return errorResponse('VALIDATION_ERROR', result.message || '处理失败', statusCode)
    }

    // 6. 返回成功响应
    return successResponse({ ok: true, message: result.message || '已记录' })
  } catch (error) {
    const errorContext = {
      userId: userId,
      campaignId: body?.campaignId,
      assignmentId: body?.assignmentId,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
    console.error('[Report] Error:', JSON.stringify(errorContext, null, 2))
    return errorResponse('INTERNAL_ERROR', '服务内部错误，请稍后重试', 500)
  }
}
