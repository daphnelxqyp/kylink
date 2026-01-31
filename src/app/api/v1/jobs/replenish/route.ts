/**
 * POST /v1/jobs/replenish
 * 
 * 库存补货定时任务端点
 * 
 * 使用场景：
 * 1. Cron Job 定时调用（建议每 5 分钟）
 * 2. 手动触发批量补货
 * 
 * 安全：需要特殊的 CRON_SECRET 或管理员 API Key
 */

import { NextRequest } from 'next/server'
import { 
  replenishAllLowStock, 
  replenishCampaign,
  getStockStats,
} from '@/lib/stock-producer'
import { authenticateRequest } from '@/lib/auth'
import { 
  parseJsonBody, 
  successResponse, 
  errorResponse,
} from '@/lib/utils'

// 请求体类型
interface ReplenishRequest {
  mode: 'all' | 'single' | 'stats'
  campaignId?: string  // mode=single 时必填
  force?: boolean      // 是否强制补货（忽略水位检查）
}

export async function POST(request: NextRequest) {
  // 1. 检查 CRON_SECRET（优先）或 API Key 鉴权
  const cronSecret = request.headers.get('X-Cron-Secret')
  const expectedSecret = process.env.CRON_SECRET

  let userId: string | null = null

  if (cronSecret && expectedSecret && cronSecret === expectedSecret) {
    // Cron Job 调用，跳过用户鉴权
    userId = null
  } else {
    // 普通 API 调用，需要鉴权
    const authResult = await authenticateRequest(request)
    if (!authResult.success) {
      return errorResponse(
        authResult.error!.code,
        authResult.error!.message,
        authResult.error!.status
      )
    }
    userId = authResult.userId!
  }

  // 2. 解析请求体
  const { data, error: parseError } = await parseJsonBody<ReplenishRequest>(request)
  if (parseError || !data) {
    return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
  }

  const { mode, campaignId, force = false } = data

  try {
    // 3. 根据模式执行不同操作
    switch (mode) {
      case 'stats': {
        // 获取库存统计
        const stats = await getStockStats(userId || undefined)
        return successResponse({
          mode: 'stats',
          ...stats,
        })
      }

      case 'single': {
        // 单个 campaign 补货
        if (!campaignId) {
          return errorResponse('VALIDATION_ERROR', 'mode=single 时必须提供 campaignId', 422)
        }
        if (!userId) {
          return errorResponse('VALIDATION_ERROR', 'mode=single 需要用户鉴权', 422)
        }

        const result = await replenishCampaign(userId, campaignId, force)
        return successResponse({
          mode: 'single',
          result,
        })
      }

      case 'all': {
        // 批量补货所有低水位 campaign（支持强制模式）
        const result = await replenishAllLowStock(force)
        return successResponse({
          mode: 'all',
          ...result,
        })
      }

      default:
        return errorResponse('VALIDATION_ERROR', 'mode 必须是 all、single 或 stats', 422)
    }

  } catch (error) {
    console.error('Replenish job error:', error)
    return errorResponse('INTERNAL_ERROR', '补货任务执行失败', 500)
  }
}

/**
 * GET /v1/jobs/replenish
 * 
 * 获取库存统计信息（简化接口）
 */
export async function GET(request: NextRequest) {
  // 鉴权
  const authResult = await authenticateRequest(request)
  if (!authResult.success) {
    return errorResponse(
      authResult.error!.code,
      authResult.error!.message,
      authResult.error!.status
    )
  }

  try {
    const stats = await getStockStats(authResult.userId!)
    return successResponse(stats)
  } catch (error) {
    console.error('Get stock stats error:', error)
    return errorResponse('INTERNAL_ERROR', '获取库存统计失败', 500)
  }
}

