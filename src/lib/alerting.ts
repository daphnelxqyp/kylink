/**
 * 监控告警模块（持久化版本）
 * 
 * 职责：
 * 1. 检测系统异常状态
 * 2. 发送告警通知（支持多种渠道）
 * 3. 持久化告警历史到数据库
 * 
 * 告警类型：
 * - 低库存告警
 * - 租约超时告警
 * - 失败率过高告警
 * - NO_STOCK 频繁告警
 * 
 * 改进说明（2026-01-20）：
 * - 告警历史持久化到数据库 Alert 表
 * - 支持分页查询告警历史
 * - 支持按用户、类型、级别过滤告警
 */

import prisma from './prisma'
import { Prisma } from '@prisma/client'
import { getStockStats } from './stock-producer'
import { getLeaseHealth } from './lease-recovery'
import { STOCK_CONFIG } from './utils'
type AlertType = 'low_stock' | 'lease_timeout' | 'high_failure_rate' | 'no_stock_frequent' | 'system_health'
type AlertLevel = 'info' | 'warning' | 'critical'

// ============================================
// 类型定义
// ============================================

// 重新导出 Prisma 的枚举类型，方便外部使用
export type { AlertType, AlertLevel }

/** 告警记录（包含数据库字段） */
export interface Alert {
  id: string
  userId?: string | null
  type: AlertType
  level: AlertLevel
  title: string
  message: string
  metadata?: Record<string, unknown> | null
  createdAt: Date
  acknowledged: boolean
  acknowledgedAt?: Date | null
}

/** Prisma Alert 记录（与数据库字段一致） */
interface PrismaAlertRecord {
  id: string
  userId: string | null
  type: AlertType
  level: AlertLevel
  title: string
  message: string
  metadata: Prisma.JsonValue
  createdAt: Date
  acknowledged: boolean
  acknowledgedAt: Date | null
}

/** 告警配置 */
export interface AlertConfig {
  // 低库存告警阈值
  lowStockThreshold: number
  // 租约超时告警阈值（分钟）
  leaseTimeoutThreshold: number
  // 失败率告警阈值（百分比）
  failureRateThreshold: number
  // NO_STOCK 频率阈值（24小时内次数）
  noStockFrequencyThreshold: number
  // 是否启用各类告警
  enableLowStock: boolean
  enableLeaseTimeout: boolean
  enableFailureRate: boolean
  enableNoStockFrequent: boolean
}

/** 告警查询选项 */
export interface AlertQueryOptions {
  userId?: string
  type?: AlertType
  level?: AlertLevel
  acknowledged?: boolean
  limit?: number
  offset?: number
}

/** 告警统计结果 */
export interface AlertStats {
  total: number
  unacknowledged: number
  byLevel: Record<AlertLevel, number>
  byType: Record<AlertType, number>
}

// ============================================
// 默认配置
// ============================================

const DEFAULT_CONFIG: AlertConfig = {
  lowStockThreshold: STOCK_CONFIG.LOW_WATERMARK,
  leaseTimeoutThreshold: STOCK_CONFIG.LEASE_TTL_MINUTES - 5, // 提前 5 分钟告警
  failureRateThreshold: 10, // 失败率超过 10%
  noStockFrequencyThreshold: 10, // 24小时内超过 10 次
  enableLowStock: true,
  enableLeaseTimeout: true,
  enableFailureRate: true,
  enableNoStockFrequent: true,
}

// ============================================
// 告警创建和通知
// ============================================

/**
 * 创建告警并持久化到数据库
 */
async function createAlert(
  type: AlertType,
  level: AlertLevel,
  title: string,
  message: string,
  metadata?: Record<string, unknown>,
  userId?: string
): Promise<Alert> {
  try {
    // 1. 持久化到数据库
    const dbAlert = await prisma.alert.create({
      data: {
        userId: userId || null,
        type,
        level,
        title,
        message,
        metadata: metadata !== undefined ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        acknowledged: false,
      },
    })

    console.log(`[Alert] Created alert ${dbAlert.id}: ${title}`)

    // 2. 同时记录到审计日志
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action: 'alert_created',
        resourceType: 'Alert',
        resourceId: dbAlert.id,
        metadata: {
          type,
          level,
          title,
          ...(metadata || {}),
        },
      },
    }).catch((err: unknown) => console.error('[Alert] Failed to log alert:', err))

    return convertPrismaAlert(dbAlert)
  } catch (error) {
    console.error('[Alert] Failed to create alert:', error)
    
    // 如果数据库写入失败，返回一个临时的内存告警对象
    return {
      id: `temp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      userId: userId || null,
      type,
      level,
      title,
      message,
      metadata,
      createdAt: new Date(),
      acknowledged: false,
    }
  }
}

/**
 * 将 Prisma Alert 转换为接口类型
 */
function convertPrismaAlert(dbAlert: PrismaAlertRecord): Alert {
  return {
    id: dbAlert.id,
    userId: dbAlert.userId,
    type: dbAlert.type,
    level: dbAlert.level,
    title: dbAlert.title,
    message: dbAlert.message,
    metadata: dbAlert.metadata as Record<string, unknown> | null,
    createdAt: dbAlert.createdAt,
    acknowledged: dbAlert.acknowledged,
    acknowledgedAt: dbAlert.acknowledgedAt,
  }
}

/**
 * 发送告警通知
 * 
 * 支持的通知渠道：
 * - 控制台日志
 * - Webhook（通过 ALERT_WEBHOOK_URL 环境变量配置）
 * - 后续可扩展：邮件、Slack、钉钉等
 */
async function sendNotification(alert: Alert): Promise<void> {
  const levelEmoji = {
    info: 'ℹ️',
    warning: '⚠️',
    critical: '🚨',
  }

  // 1. 控制台日志
  console.log(`[Alert] ${levelEmoji[alert.level]} ${alert.level.toUpperCase()}: ${alert.title}`)
  console.log(`[Alert] ${alert.message}`)
  
  if (alert.metadata) {
    console.log(`[Alert] Metadata:`, JSON.stringify(alert.metadata, null, 2))
  }

  // 2. Webhook 通知
  const webhookUrl = process.env.ALERT_WEBHOOK_URL
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: alert.id,
          level: alert.level,
          type: alert.type,
          title: alert.title,
          message: alert.message,
          metadata: alert.metadata,
          timestamp: alert.createdAt.toISOString(),
        }),
      })
      console.log('[Alert] Webhook notification sent')
    } catch (error) {
      console.error('[Alert] Failed to send webhook:', error)
    }
  }
}

// ============================================
// 告警检查函数
// ============================================

/**
 * 检查低库存
 */
async function checkLowStock(config: AlertConfig): Promise<Alert[]> {
  const alerts: Alert[] = []
  
  if (!config.enableLowStock) return alerts

  try {
    const { campaigns, summary } = await getStockStats()

    // 检查整体情况
    if (summary.lowStockCampaigns > 0) {
      const lowStockCampaigns = campaigns.filter(c => c.needsReplenish)
      
      const level: AlertLevel = 
        summary.lowStockCampaigns > 5 ? 'critical' :
        summary.lowStockCampaigns > 2 ? 'warning' : 'info'

      const alert = await createAlert(
        'low_stock',
        level,
        `${summary.lowStockCampaigns} 个 Campaign 库存不足`,
        `以下 Campaign 可用库存低于阈值 ${config.lowStockThreshold}：${lowStockCampaigns.map(c => `${c.campaignId}(${c.available})`).join(', ')}`,
        {
          lowStockCampaigns: summary.lowStockCampaigns,
          totalCampaigns: summary.totalCampaigns,
          campaigns: lowStockCampaigns,
        }
      )
      
      alerts.push(alert)
      await sendNotification(alert)
    }
  } catch (error) {
    console.error('[Alert] checkLowStock error:', error)
  }

  return alerts
}

/**
 * 检查租约超时
 */
async function checkLeaseTimeout(config: AlertConfig): Promise<Alert[]> {
  const alerts: Alert[] = []
  
  if (!config.enableLeaseTimeout) return alerts

  try {
    const health = await getLeaseHealth()

    // 检查是否有即将超时的租约
    if (health.oldestActiveMinutes !== null && 
        health.oldestActiveMinutes >= config.leaseTimeoutThreshold) {
      
      const level: AlertLevel = 
        health.oldestActiveMinutes >= STOCK_CONFIG.LEASE_TTL_MINUTES ? 'critical' : 'warning'

      const alert = await createAlert(
        'lease_timeout',
        level,
        `检测到长时间未确认的租约`,
        `最旧的活跃租约已持续 ${health.oldestActiveMinutes} 分钟（阈值 ${STOCK_CONFIG.LEASE_TTL_MINUTES} 分钟），共 ${health.activeLease} 个活跃租约`,
        {
          activeLeases: health.activeLease,
          oldestMinutes: health.oldestActiveMinutes,
          threshold: STOCK_CONFIG.LEASE_TTL_MINUTES,
        }
      )
      
      alerts.push(alert)
      await sendNotification(alert)
    }
  } catch (error) {
    console.error('[Alert] checkLeaseTimeout error:', error)
  }

  return alerts
}

/**
 * 检查失败率
 */
async function checkFailureRate(config: AlertConfig): Promise<Alert[]> {
  const alerts: Alert[] = []
  
  if (!config.enableFailureRate) return alerts

  try {
    // 统计最近 1 小时的租约成功/失败率
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    
    const recentLeases = await prisma.suffixLease.groupBy({
      by: ['status'],
      where: {
        leasedAt: { gte: oneHourAgo },
        deletedAt: null,
      },
      _count: true,
    })

    const statusMap = new Map(recentLeases.map((s: { status: string; _count: number }) => [s.status, s._count]))
    const consumed = statusMap.get('consumed') || 0
    const failed = statusMap.get('failed') || 0
    const total = consumed + failed

    if (total > 0) {
      const failureRate = (failed / total) * 100

      if (failureRate >= config.failureRateThreshold) {
        const level: AlertLevel = failureRate >= 20 ? 'critical' : 'warning'

        const alert = await createAlert(
          'high_failure_rate',
          level,
          `租约失败率过高: ${failureRate.toFixed(1)}%`,
          `最近 1 小时内，${total} 个租约中有 ${failed} 个失败（失败率 ${failureRate.toFixed(1)}%，阈值 ${config.failureRateThreshold}%）`,
          {
            consumed,
            failed,
            total,
            failureRate: failureRate.toFixed(2),
            threshold: config.failureRateThreshold,
          }
        )
        
        alerts.push(alert)
        await sendNotification(alert)
      }
    }
  } catch (error) {
    console.error('[Alert] checkFailureRate error:', error)
  }

  return alerts
}

/**
 * 检查 NO_STOCK 频率
 */
async function checkNoStockFrequency(config: AlertConfig): Promise<Alert[]> {
  const alerts: Alert[] = []
  
  if (!config.enableNoStockFrequent) return alerts

  try {
    // 统计最近 24 小时的 NO_STOCK 审计日志
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    
    const noStockCount = await prisma.auditLog.count({
      where: {
        action: 'no_stock',
        createdAt: { gte: oneDayAgo },
      },
    })

    if (noStockCount >= config.noStockFrequencyThreshold) {
      const level: AlertLevel = noStockCount >= 50 ? 'critical' : 'warning'

      const alert = await createAlert(
        'no_stock_frequent',
        level,
        `NO_STOCK 告警频繁: 24小时内 ${noStockCount} 次`,
        `最近 24 小时内发生 ${noStockCount} 次库存不足（阈值 ${config.noStockFrequencyThreshold} 次），请检查库存补货配置`,
        {
          count: noStockCount,
          threshold: config.noStockFrequencyThreshold,
          period: '24h',
        }
      )
      
      alerts.push(alert)
      await sendNotification(alert)
    }
  } catch (error) {
    console.error('[Alert] checkNoStockFrequency error:', error)
  }

  return alerts
}

// ============================================
// 公共 API
// ============================================

/**
 * 执行所有检查并发送告警
 */
export async function checkAndAlert(
  config: AlertConfig = DEFAULT_CONFIG
): Promise<{
  checked: string[]
  alerts: Alert[]
}> {
  const allAlerts: Alert[] = []
  const checked: string[] = []

  try {
    // 1. 检查低库存
    checked.push('low_stock')
    const lowStockAlerts = await checkLowStock(config)
    allAlerts.push(...lowStockAlerts)

    // 2. 检查租约超时
    checked.push('lease_timeout')
    const leaseAlerts = await checkLeaseTimeout(config)
    allAlerts.push(...leaseAlerts)

    // 3. 检查失败率
    checked.push('failure_rate')
    const failureAlerts = await checkFailureRate(config)
    allAlerts.push(...failureAlerts)

    // 4. 检查 NO_STOCK 频率
    checked.push('no_stock_frequency')
    const noStockAlerts = await checkNoStockFrequency(config)
    allAlerts.push(...noStockAlerts)

    console.log(`[Alert] Check completed: ${checked.length} checks, ${allAlerts.length} alerts`)

  } catch (error) {
    console.error('[Alert] Check failed:', error)
  }

  return { checked, alerts: allAlerts }
}

/**
 * 获取告警历史（从数据库查询）
 */
export async function getAlertHistory(options: AlertQueryOptions = {}): Promise<Alert[]> {
  const {
    userId,
    type,
    level,
    acknowledged,
    limit = 50,
    offset = 0,
  } = options

  try {
    const alerts = await prisma.alert.findMany({
      where: {
        deletedAt: null,
        ...(userId ? { userId } : {}),
        ...(type ? { type } : {}),
        ...(level ? { level } : {}),
        ...(acknowledged !== undefined ? { acknowledged } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    })

    return alerts.map(convertPrismaAlert)
  } catch (error) {
    console.error('[Alert] Failed to get alert history:', error)
    return []
  }
}

/**
 * 确认告警
 */
export async function acknowledgeAlert(alertId: string): Promise<boolean> {
  try {
    await prisma.alert.update({
      where: { id: alertId },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date(),
      },
    })

    // 记录审计日志
    await prisma.auditLog.create({
      data: {
        action: 'alert_acknowledged',
        resourceType: 'Alert',
        resourceId: alertId,
      },
    }).catch((err: unknown) => console.error('[Alert] Failed to log acknowledge:', err))

    return true
  } catch (error) {
    console.error('[Alert] Failed to acknowledge alert:', error)
    return false
  }
}

/**
 * 批量确认告警
 */
export async function acknowledgeAlerts(alertIds: string[]): Promise<number> {
  try {
    const result = await prisma.alert.updateMany({
      where: {
        id: { in: alertIds },
        acknowledged: false,
      },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date(),
      },
    })

    return result.count
  } catch (error) {
    console.error('[Alert] Failed to acknowledge alerts:', error)
    return 0
  }
}

/**
 * 获取告警统计（从数据库聚合）
 */
export async function getAlertStats(userId?: string): Promise<AlertStats> {
  try {
    // 基础条件
    const baseWhere = {
      deletedAt: null,
      ...(userId ? { userId } : {}),
    }

    // 1. 总数和未确认数
    const [total, unacknowledged] = await Promise.all([
      prisma.alert.count({ where: baseWhere }),
      prisma.alert.count({ where: { ...baseWhere, acknowledged: false } }),
    ])

    // 2. 按级别分组统计
    const levelStats = await prisma.alert.groupBy({
      by: ['level'],
      where: baseWhere,
      _count: true,
    })

    const byLevel: Record<AlertLevel, number> = {
      info: 0,
      warning: 0,
      critical: 0,
    }
    for (const stat of levelStats) {
      byLevel[stat.level] = stat._count
    }

    // 3. 按类型分组统计
    const typeStats = await prisma.alert.groupBy({
      by: ['type'],
      where: baseWhere,
      _count: true,
    })

    const byType: Record<AlertType, number> = {
      low_stock: 0,
      lease_timeout: 0,
      high_failure_rate: 0,
      no_stock_frequent: 0,
      system_health: 0,
    }
    for (const stat of typeStats) {
      byType[stat.type] = stat._count
    }

    return {
      total,
      unacknowledged,
      byLevel,
      byType,
    }
  } catch (error) {
    console.error('[Alert] Failed to get alert stats:', error)
    return {
      total: 0,
      unacknowledged: 0,
      byLevel: { info: 0, warning: 0, critical: 0 },
      byType: {
        low_stock: 0,
        lease_timeout: 0,
        high_failure_rate: 0,
        no_stock_frequent: 0,
        system_health: 0,
      },
    }
  }
}

/**
 * 删除告警（软删除）
 */
export async function deleteAlert(alertId: string): Promise<boolean> {
  try {
    await prisma.alert.update({
      where: { id: alertId },
      data: { deletedAt: new Date() },
    })
    return true
  } catch (error) {
    console.error('[Alert] Failed to delete alert:', error)
    return false
  }
}

/**
 * 清理旧告警（超过指定天数的已确认告警）
 */
export async function cleanupOldAlerts(daysToKeep: number = 30): Promise<number> {
  try {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000)
    
    const result = await prisma.alert.updateMany({
      where: {
        acknowledged: true,
        createdAt: { lt: cutoffDate },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    })

    if (result.count > 0) {
      console.log(`[Alert] Cleaned up ${result.count} old alerts (older than ${daysToKeep} days)`)
    }

    return result.count
  } catch (error) {
    console.error('[Alert] Failed to cleanup old alerts:', error)
    return 0
  }
}

/**
 * 手动创建告警（供外部调用）
 */
export async function createManualAlert(
  type: AlertType,
  level: AlertLevel,
  title: string,
  message: string,
  metadata?: Record<string, unknown>,
  userId?: string
): Promise<Alert> {
  const alert = await createAlert(type, level, title, message, metadata, userId)
  await sendNotification(alert)
  return alert
}
