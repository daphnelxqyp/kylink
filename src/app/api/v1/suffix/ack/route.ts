/**
 * POST /v1/suffix/ack
 *
 * @deprecated 此接口已废弃，请使用 /v1/suffix/report
 * 保留用于向后兼容，将在 2026-02-18 后移除
 */

import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { successResponse, errorResponse } from '@/lib/utils'

export async function POST(request: NextRequest) {
  try {
    // 鉴权
    const authResult = await authenticateRequest(request)
    if (!authResult.success) {
      return errorResponse(
        authResult.error!.code,
        authResult.error!.message,
        authResult.error!.status
      )
    }

    // 直接返回成功（兼容模式）
    return successResponse({
      ok: true,
      message: '接口已废弃，请使用 /v1/suffix/report',
    })
  } catch (error) {
    return errorResponse('INTERNAL_ERROR', '服务内部错误', 500)
  }
}
