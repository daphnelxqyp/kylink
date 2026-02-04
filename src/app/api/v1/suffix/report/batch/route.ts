/**
 * POST /v1/suffix/report/batch
 *
 * 批量回传写入结果
 *
 * 核心逻辑：
 * - 批量记录写入结果日志
 * - 每个回传独立处理，部分失败不影响其他
 * - 支持幂等：重复回传不会重复记录
 */

import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { processBatchReport, SingleReportRequest } from '@/lib/assignment-service'
import {
  parseJsonBody,
  successResponse,
  errorResponse,
} from '@/lib/utils'

// 批量大小限制（可通过环境变量配置）
const MAX_BATCH_SIZE = parseInt(process.env.MAX_BATCH_SIZE || '500', 10)

interface BatchReportRequest {
  reports: SingleReportRequest[]
}

export async function POST(request: NextRequest) {
  let userId: string | undefined
  let body: BatchReportRequest | undefined

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
    const { data, error: parseError } = await parseJsonBody<BatchReportRequest>(request)
    if (parseError || !data) {
      return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
    }
    body = data

    // 3. 验证 reports 数组
    if (!Array.isArray(data.reports) || data.reports.length === 0) {
      return errorResponse('VALIDATION_ERROR', 'reports 必须是非空数组', 422)
    }

    // 4. 检查批量大小
    if (data.reports.length > MAX_BATCH_SIZE) {
      return errorResponse(
        'VALIDATION_ERROR',
        `批量大小超过限制（最大 ${MAX_BATCH_SIZE} 条）`,
        422
      )
    }

    // 5. 调用服务层批量处理
    const results = await processBatchReport(userId, data.reports)

    // 6. 返回结果数组
    return successResponse({ results })
  } catch (error) {
    const errorContext = {
      userId: userId,
      batchSize: body?.reports?.length,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }
    console.error('[Report Batch] Error:', JSON.stringify(errorContext, null, 2))
    return errorResponse('INTERNAL_ERROR', '服务内部错误，请稍后重试', 500)
  }
}
