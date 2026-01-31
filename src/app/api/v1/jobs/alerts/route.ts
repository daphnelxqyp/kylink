/**
 * GET/POST /v1/jobs/alerts
 * 
 * 告警管理端点（持久化版本）
 * 
 * 功能：
 * - GET: 获取告警历史和统计（从数据库查询）
 * - POST: 手动触发告警检查或确认告警
 */

import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { 
  checkAndAlert,
  getAlertHistory,
  getAlertStats,
  acknowledgeAlert,
  acknowledgeAlerts,
  type AlertLevel,
  type AlertType,
} from '@/lib/alerting'
import { 
  parseJsonBody, 
  successResponse, 
  errorResponse,
} from '@/lib/utils'

// 请求体类型
interface AlertRequest {
  action: 'check' | 'acknowledge' | 'acknowledge_batch' | 'stats'
  alertId?: string       // action=acknowledge 时必填
  alertIds?: string[]    // action=acknowledge_batch 时必填
  level?: AlertLevel     // 过滤级别
  type?: AlertType       // 过滤类型
  acknowledged?: boolean // 过滤已确认/未确认
  limit?: number         // 历史记录限制
  offset?: number        // 分页偏移
}

/**
 * GET /v1/jobs/alerts - 获取告警历史
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request)
  if (!authResult.success) {
    return errorResponse(
      authResult.error!.code,
      authResult.error!.message,
      authResult.error!.status
    )
  }

  try {
    // 解析查询参数
    const url = new URL(request.url)
    const level = url.searchParams.get('level') as AlertLevel | null
    const type = url.searchParams.get('type') as AlertType | null
    const acknowledgedParam = url.searchParams.get('acknowledged')
    const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10)
    const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10)
    
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0
    
    // 解析 acknowledged 参数
    let acknowledged: boolean | undefined
    if (acknowledgedParam === 'true') acknowledged = true
    else if (acknowledgedParam === 'false') acknowledged = false

    // 异步获取告警历史和统计
    const [history, stats] = await Promise.all([
      getAlertHistory({
        level: level || undefined,
        type: type || undefined,
        acknowledged,
        limit,
        offset,
      }),
      getAlertStats(),
    ])

    return successResponse({
      history,
      stats,
      pagination: {
        limit,
        offset,
        hasMore: history.length === limit,
      },
    })
  } catch (error) {
    console.error('Get alerts error:', error)
    return errorResponse('INTERNAL_ERROR', '获取告警失败', 500)
  }
}

/**
 * POST /v1/jobs/alerts - 告警操作
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request)
  if (!authResult.success) {
    return errorResponse(
      authResult.error!.code,
      authResult.error!.message,
      authResult.error!.status
    )
  }

  const { data, error: parseError } = await parseJsonBody<AlertRequest>(request)
  if (parseError || !data) {
    return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
  }

  const { action, alertId, alertIds, level, type, acknowledged, limit = 50, offset = 0 } = data

  try {
    switch (action) {
      case 'check': {
        // 手动触发告警检查
        const result = await checkAndAlert()
        return successResponse({
          action: 'check',
          ...result,
        })
      }

      case 'acknowledge': {
        // 确认单个告警
        if (!alertId) {
          return errorResponse('VALIDATION_ERROR', 'action=acknowledge 时必须提供 alertId', 422)
        }

        const success = await acknowledgeAlert(alertId)
        return successResponse({
          action: 'acknowledge',
          alertId,
          success,
        })
      }

      case 'acknowledge_batch': {
        // 批量确认告警
        if (!alertIds || !Array.isArray(alertIds) || alertIds.length === 0) {
          return errorResponse('VALIDATION_ERROR', 'action=acknowledge_batch 时必须提供 alertIds 数组', 422)
        }

        const count = await acknowledgeAlerts(alertIds)
        return successResponse({
          action: 'acknowledge_batch',
          requestedCount: alertIds.length,
          acknowledgedCount: count,
        })
      }

      case 'stats': {
        // 获取统计和历史
        const [stats, history] = await Promise.all([
          getAlertStats(),
          getAlertHistory({
            level: level || undefined,
            type: type || undefined,
            acknowledged,
            limit,
            offset,
          }),
        ])
        
        return successResponse({
          action: 'stats',
          stats,
          recentAlerts: history,
        })
      }

      default:
        return errorResponse('VALIDATION_ERROR', 'action 必须是 check、acknowledge、acknowledge_batch 或 stats', 422)
    }
  } catch (error) {
    console.error('Alert action error:', error)
    return errorResponse('INTERNAL_ERROR', '告警操作失败', 500)
  }
}
