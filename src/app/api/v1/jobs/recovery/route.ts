/**
 * GET/POST /v1/jobs/recovery
 * 
 * 租约回收任务端点
 * 
 * 功能：
 * - GET: 获取租约健康状态
 * - POST: 执行租约回收或库存清理
 */

import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { 
  recoverExpiredLeases,
  cleanupExpiredStock,
  getLeaseHealth,
} from '@/lib/lease-recovery'
import { 
  parseJsonBody, 
  successResponse, 
  errorResponse,
} from '@/lib/utils'

// 请求体类型
interface RecoveryRequest {
  action: 'recover_leases' | 'cleanup_stock' | 'all'
}

/**
 * GET /v1/jobs/recovery - 获取租约健康状态
 */
export async function GET(request: NextRequest) {
  // 检查 CRON_SECRET 或 API Key
  const cronSecret = request.headers.get('X-Cron-Secret')
  const expectedSecret = process.env.CRON_SECRET

  if (!(cronSecret && expectedSecret && cronSecret === expectedSecret)) {
    const authResult = await authenticateRequest(request)
    if (!authResult.success) {
      return errorResponse(
        authResult.error!.code,
        authResult.error!.message,
        authResult.error!.status
      )
    }
  }

  try {
    const health = await getLeaseHealth()
    return successResponse({
      health,
      thresholds: {
        leaseTimeoutMinutes: 15,
        stockExpiryHours: 48,
      },
    })
  } catch (error) {
    console.error('Get lease health error:', error)
    return errorResponse('INTERNAL_ERROR', '获取健康状态失败', 500)
  }
}

/**
 * POST /v1/jobs/recovery - 执行回收任务
 */
export async function POST(request: NextRequest) {
  // 检查 CRON_SECRET 或 API Key
  const cronSecret = request.headers.get('X-Cron-Secret')
  const expectedSecret = process.env.CRON_SECRET

  if (!(cronSecret && expectedSecret && cronSecret === expectedSecret)) {
    const authResult = await authenticateRequest(request)
    if (!authResult.success) {
      return errorResponse(
        authResult.error!.code,
        authResult.error!.message,
        authResult.error!.status
      )
    }
  }

  const { data, error: parseError } = await parseJsonBody<RecoveryRequest>(request)
  if (parseError || !data) {
    return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
  }

  const { action } = data

  try {
    switch (action) {
      case 'recover_leases': {
        const result = await recoverExpiredLeases()
        return successResponse({
          action: 'recover_leases',
          ...result,
        })
      }

      case 'cleanup_stock': {
        const result = await cleanupExpiredStock()
        return successResponse({
          action: 'cleanup_stock',
          ...result,
        })
      }

      case 'all': {
        const leaseResult = await recoverExpiredLeases()
        const stockResult = await cleanupExpiredStock()
        return successResponse({
          action: 'all',
          leaseRecovery: leaseResult,
          stockCleanup: stockResult,
        })
      }

      default:
        return errorResponse('VALIDATION_ERROR', 'action 必须是 recover_leases、cleanup_stock 或 all', 422)
    }
  } catch (error) {
    console.error('Recovery action error:', error)
    return errorResponse('INTERNAL_ERROR', '回收任务执行失败', 500)
  }
}

