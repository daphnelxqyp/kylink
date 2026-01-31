/**
 * 租约超时回收模块
 * 
 * 职责：
 * 1. 检测超时未 ack 的租约
 * 2. 回收租约关联的库存
 * 3. 记录回收日志
 * 
 * PRD 配置：
 * - leaseTtlMinutes = 15（租约超时时间）
 */

import prisma from './prisma'
import { STOCK_CONFIG } from './utils'

// 回收结果类型
export interface RecoveryResult {
  totalExpired: number
  recovered: number
  errors: number
  details: Array<{
    leaseId: string
    campaignId: string
    status: 'recovered' | 'error'
    message?: string
  }>
}

/**
 * 回收超时的租约
 */
export async function recoverExpiredLeases(): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    totalExpired: 0,
    recovered: 0,
    errors: 0,
    details: [],
  }

  try {
    // 计算超时时间点
    const expiryTime = new Date(
      Date.now() - STOCK_CONFIG.LEASE_TTL_MINUTES * 60 * 1000
    )

    // 查找所有超时的租约（状态为 leased，且超过 TTL）
    const expiredLeases = await prisma.suffixLease.findMany({
      where: {
        status: 'leased',
        leasedAt: {
          lt: expiryTime,
        },
        deletedAt: null,
      },
      include: {
        suffixStockItem: true,
      },
    })

    result.totalExpired = expiredLeases.length

    if (expiredLeases.length === 0) {
      console.log('[Recovery] No expired leases found')
      return result
    }

    console.log(`[Recovery] Found ${expiredLeases.length} expired leases`)

    // 逐个回收
    for (const lease of expiredLeases) {
      try {
        await prisma.$transaction([
          // 1. 更新租约状态为 expired
          prisma.suffixLease.update({
            where: { id: lease.id },
            data: {
              status: 'expired',
              ackedAt: new Date(),
              errorMessage: `Expired after ${STOCK_CONFIG.LEASE_TTL_MINUTES} minutes without ack`,
            },
          }),
          // 2. 回收库存（恢复为 available）
          prisma.suffixStockItem.update({
            where: { id: lease.suffixStockItemId },
            data: {
              status: 'available',
              leasedAt: null,
            },
          }),
        ])

        result.recovered++
        result.details.push({
          leaseId: lease.id,
          campaignId: lease.campaignId,
          status: 'recovered',
          message: `Recovered after ${Math.round((Date.now() - lease.leasedAt.getTime()) / 60000)} minutes`,
        })

        console.log(`[Recovery] Recovered lease ${lease.id} for campaign ${lease.campaignId}`)

      } catch (error) {
        result.errors++
        result.details.push({
          leaseId: lease.id,
          campaignId: lease.campaignId,
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        })
        console.error(`[Recovery] Failed to recover lease ${lease.id}:`, error)
      }
    }

    // 记录审计日志
    if (result.recovered > 0) {
      await prisma.auditLog.create({
        data: {
          action: 'lease_recovery',
          resourceType: 'SuffixLease',
          metadata: {
            totalExpired: result.totalExpired,
            recovered: result.recovered,
            errors: result.errors,
          },
        },
      })
    }

    return result

  } catch (error) {
    console.error('[Recovery] Batch recovery failed:', error)
    result.errors++
    result.details.push({
      leaseId: 'unknown',
      campaignId: 'unknown',
      status: 'error',
      message: error instanceof Error ? error.message : 'Batch recovery failed',
    })
    return result
  }
}

/**
 * 清理过期的 suffix 库存
 * 
 * PRD 配置：suffixTtlHours = 48
 */
export async function cleanupExpiredStock(): Promise<{
  cleaned: number
  errors: number
}> {
  try {
    const expiryTime = new Date(
      Date.now() - STOCK_CONFIG.SUFFIX_TTL_HOURS * 60 * 60 * 1000
    )

    // 软删除过期的 available 状态库存
    const result = await prisma.suffixStockItem.updateMany({
      where: {
        status: 'available',
        createdAt: {
          lt: expiryTime,
        },
        deletedAt: null,
      },
      data: {
        status: 'expired',
        expiredAt: new Date(),
        deletedAt: new Date(),
      },
    })

    if (result.count > 0) {
      console.log(`[Cleanup] Expired ${result.count} old stock items`)

      await prisma.auditLog.create({
        data: {
          action: 'stock_cleanup',
          resourceType: 'SuffixStockItem',
          metadata: {
            cleaned: result.count,
            expiryHours: STOCK_CONFIG.SUFFIX_TTL_HOURS,
          },
        },
      })
    }

    return {
      cleaned: result.count,
      errors: 0,
    }

  } catch (error) {
    console.error('[Cleanup] Failed to clean expired stock:', error)
    return {
      cleaned: 0,
      errors: 1,
    }
  }
}

/**
 * 获取租约健康状态
 */
export async function getLeaseHealth(): Promise<{
  activeLease: number
  expiredLeases: number
  failedLeases: number
  oldestActiveMinutes: number | null
}> {
  const now = new Date()

  // 统计各状态租约数量
  const stats = await prisma.suffixLease.groupBy({
    by: ['status'],
    where: {
      deletedAt: null,
    },
    _count: true,
  })

  const statusMap = new Map(stats.map(s => [s.status, s._count]))

  // 查找最旧的活跃租约
  const oldestActive = await prisma.suffixLease.findFirst({
    where: {
      status: 'leased',
      deletedAt: null,
    },
    orderBy: {
      leasedAt: 'asc',
    },
    select: {
      leasedAt: true,
    },
  })

  const oldestActiveMinutes = oldestActive
    ? Math.round((now.getTime() - oldestActive.leasedAt.getTime()) / 60000)
    : null

  return {
    activeLease: statusMap.get('leased') || 0,
    expiredLeases: statusMap.get('expired') || 0,
    failedLeases: statusMap.get('failed') || 0,
    oldestActiveMinutes,
  }
}

