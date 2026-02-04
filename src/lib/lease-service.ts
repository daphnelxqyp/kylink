/**
 * Lease 服务层
 *
 * 提取 lease 和 lease/batch 的公共业务逻辑
 * 实现单一职责原则，便于测试和维护
 */

import prisma from './prisma'
import { triggerReplenishAsync } from './stock-producer'

// ============================================
// 类型定义
// ============================================

/**
 * 单个 Campaign 租赁请求
 */
export interface CampaignLeaseRequest {
  campaignId: string
  nowClicks: number
  observedAt: string
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

/**
 * 单个 Campaign 租赁结果
 */
export interface CampaignLeaseResult {
  campaignId: string
  action?: 'APPLY' | 'NOOP'
  leaseId?: string
  finalUrlSuffix?: string
  reason?: string
  code?: string
  message?: string
}

/**
 * 单个 Ack 请求
 */
export interface SingleAckRequest {
  leaseId: string
  campaignId: string
  applied: boolean
  appliedAt: string
  errorMessage?: string
}

/**
 * 单个 Ack 结果
 */
export interface SingleAckResult {
  leaseId: string
  ok: boolean
  message?: string
  previousStatus?: string
}

// ============================================
// Lease 核心逻辑
// ============================================

/**
 * 处理单个 campaign 的 lease 逻辑
 *
 * 核心流程：
 * 1. 检查幂等：是否已有相同 idempotencyKey 的租约
 * 2. 检查/创建 CampaignMeta（惰性同步）
 * 3. 获取/创建 CampaignClickState
 * 4. 计算 delta = nowClicks - lastAppliedClicks
 * 5. delta <= 0 返回 NOOP
 * 6. delta > 0 检查活跃租约或分配新租约
 * 7. 异步触发库存补货检查
 */
export async function processSingleLease(
  userId: string,
  campaign: CampaignLeaseRequest
): Promise<CampaignLeaseResult> {
  const {
    campaignId,
    nowClicks,
    observedAt,
    windowStartEpochSeconds,
    idempotencyKey,
    meta,
  } = campaign

  try {
    // 1. 检查幂等：是否已有相同 idempotencyKey 的租约
    const existingLease = await prisma.suffixLease.findFirst({
      where: {
        userId,
        idempotencyKey,
        deletedAt: null,
      },
      include: {
        suffixStockItem: true,
      },
    })

    // 如果已存在租约，直接返回（幂等）
    // 简化后：租约直接 consumed，所以这里返回已消费的 suffix（防止重复请求）
    if (existingLease) {
      return {
        campaignId,
        action: 'APPLY',
        leaseId: existingLease.id,
        finalUrlSuffix: existingLease.suffixStockItem.finalUrlSuffix,
        reason: '返回已存在的租约（幂等重试）',
      }
    }

    // 2. 检查/创建 CampaignMeta（惰性同步）
    let campaignMeta = await prisma.campaignMeta.findFirst({
      where: {
        userId,
        campaignId,
        deletedAt: null,
      },
    })

    if (!campaignMeta) {
      if (meta) {
        // 惰性创建
        campaignMeta = await prisma.campaignMeta.create({
          data: {
            userId,
            campaignId,
            campaignName: meta.campaignName,
            country: meta.country,
            finalUrl: meta.finalUrl,
            cid: meta.cid,
            mccId: meta.mccId,
            status: 'active',
            lastSyncedAt: new Date(),
          },
        })
      } else {
        return {
          campaignId,
          code: 'PENDING_IMPORT',
          message: 'Campaign 未导入，请先同步或在请求中附带 meta',
        }
      }
    } else if (meta) {
      // 检查是否需要更新
      const needsUpdate =
        campaignMeta.campaignName !== meta.campaignName ||
        campaignMeta.country !== meta.country ||
        campaignMeta.finalUrl !== meta.finalUrl ||
        campaignMeta.cid !== meta.cid ||
        campaignMeta.mccId !== meta.mccId

      if (needsUpdate) {
        await prisma.campaignMeta.update({
          where: { id: campaignMeta.id },
          data: {
            campaignName: meta.campaignName,
            country: meta.country,
            finalUrl: meta.finalUrl,
            cid: meta.cid,
            mccId: meta.mccId,
            lastSyncedAt: new Date(),
          },
        })
      }
    }

    // 3. 获取/创建 CampaignClickState
    let clickState = await prisma.campaignClickState.findUnique({
      where: {
        userId_campaignId: {
          userId,
          campaignId,
        },
      },
    })

    if (!clickState) {
      clickState = await prisma.campaignClickState.create({
        data: {
          userId,
          campaignId,
          lastAppliedClicks: 0,
          lastObservedClicks: nowClicks,
          lastObservedAt: new Date(observedAt),
        },
      })
    } else {
      // 更新观测值
      await prisma.campaignClickState.update({
        where: {
          userId_campaignId: {
            userId,
            campaignId,
          },
        },
        data: {
          lastObservedClicks: nowClicks,
          lastObservedAt: new Date(observedAt),
        },
      })
    }

    // 4. 计算 delta
    const delta = nowClicks - clickState.lastAppliedClicks

    // 5. delta <= 0，返回 NOOP
    if (delta <= 0) {
      return {
        campaignId,
        action: 'NOOP',
        reason: `delta=${delta}，无需换链`,
      }
    }

    // 6. delta > 0，从库存获取一条可用的 suffix
    // 注：简化后不再检查活跃租约（因为租约直接 consumed）
    const availableSuffix = await prisma.suffixStockItem.findFirst({
      where: {
        userId,
        campaignId,
        status: 'available',
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })

    if (!availableSuffix) {
      // 异步触发紧急补货
      triggerReplenishAsync(userId, campaignId)

      return {
        campaignId,
        code: 'NO_STOCK',
        message: '库存不足',
      }
    }

    // 8. 创建租约并直接消费（简化流程，无需 ACK）
    const now = new Date()
    const [newLease] = await prisma.$transaction([
      prisma.suffixLease.create({
        data: {
          userId,
          campaignId,
          suffixStockItemId: availableSuffix.id,
          idempotencyKey,
          nowClicksAtLeaseTime: nowClicks,
          windowStartEpochSeconds: BigInt(windowStartEpochSeconds),
          status: 'consumed',  // 直接标记为已消费
          leasedAt: now,
          ackedAt: now,        // 自动确认
          applied: true,       // 假设写入成功
        },
      }),
      prisma.suffixStockItem.update({
        where: { id: availableSuffix.id },
        data: {
          status: 'consumed',  // 直接标记为已消费
          leasedAt: now,
          consumedAt: now,
        },
      }),
      // 同时更新 lastAppliedClicks
      prisma.$executeRaw`
        UPDATE CampaignClickState
        SET lastAppliedClicks = GREATEST(lastAppliedClicks, ${nowClicks}),
            updatedAt = NOW()
        WHERE userId = ${userId} AND campaignId = ${campaignId}
      `,
    ])

    // 9. 异步检查库存水位，必要时补货
    triggerReplenishAsync(userId, campaignId)

    return {
      campaignId,
      action: 'APPLY',
      leaseId: newLease.id,
      finalUrlSuffix: availableSuffix.finalUrlSuffix,
      reason: `delta=${delta}，分配新租约`,
    }
  } catch (error) {
    console.error(`[LeaseService] Lease error for campaign ${campaignId}:`, error)
    return {
      campaignId,
      code: 'INTERNAL_ERROR',
      message: '处理失败',
    }
  }
}

// ============================================
// Ack 核心逻辑
// ============================================

/**
 * 处理单个 ack 逻辑
 *
 * 核心流程：
 * 1. 查找租约
 * 2. 幂等检查：已处理则直接返回
 * 3. 根据 applied 状态更新租约和库存
 * 4. 更新 lastAppliedClicks
 */
export async function processSingleAck(
  userId: string,
  ack: SingleAckRequest
): Promise<SingleAckResult> {
  const { leaseId, campaignId, applied, appliedAt, errorMessage } = ack

  try {
    // 1. 查找租约
    const lease = await prisma.suffixLease.findFirst({
      where: {
        id: leaseId,
        userId,
        campaignId,
        deletedAt: null,
      },
    })

    // 租约不存在
    if (!lease) {
      return {
        leaseId,
        ok: false,
        message: '租约不存在或无权访问',
      }
    }

    // 2. 幂等检查：如果已经 ack 过，直接返回成功
    if (lease.status === 'consumed' || lease.status === 'failed') {
      return {
        leaseId,
        ok: true,
        message: '租约已处理（幂等）',
        previousStatus: lease.status,
      }
    }

    // 3. 处理 ack
    if (applied) {
      // 成功写入
      await prisma.$transaction([
        prisma.suffixLease.update({
          where: { id: leaseId },
          data: {
            status: 'consumed',
            applied: true,
            ackedAt: new Date(appliedAt),
          },
        }),
        prisma.suffixStockItem.update({
          where: { id: lease.suffixStockItemId },
          data: {
            status: 'consumed',
            consumedAt: new Date(appliedAt),
          },
        }),
        // 更新 lastAppliedClicks
        prisma.$executeRaw`
          UPDATE CampaignClickState
          SET lastAppliedClicks = GREATEST(lastAppliedClicks, ${lease.nowClicksAtLeaseTime}),
              updatedAt = NOW()
          WHERE userId = ${userId} AND campaignId = ${campaignId}
        `,
      ])

      return {
        leaseId,
        ok: true,
      }
    } else {
      // 写入失败 - 立即释放库存回可用池
      await prisma.$transaction([
        // 1. 更新租约状态为 failed
        prisma.suffixLease.update({
          where: { id: leaseId },
          data: {
            status: 'failed',
            applied: false,
            ackedAt: new Date(appliedAt),
            errorMessage: errorMessage || '写入失败（未提供详细原因）',
          },
        }),
        // 2. 立即释放库存回可用池
        prisma.suffixStockItem.update({
          where: { id: lease.suffixStockItemId },
          data: {
            status: 'available',
            leasedAt: null, // 清除租出时间
          },
        }),
      ])

      return {
        leaseId,
        ok: true,
      }
    }
  } catch (error) {
    console.error(`[LeaseService] Ack error for lease ${leaseId}:`, error)
    return {
      leaseId,
      ok: false,
      message: '处理失败',
    }
  }
}

// ============================================
// 批量处理
// ============================================

/**
 * 批量处理 lease 请求
 */
export async function processBatchLease(
  userId: string,
  campaigns: CampaignLeaseRequest[]
): Promise<CampaignLeaseResult[]> {
  return Promise.all(
    campaigns.map(campaign => processSingleLease(userId, campaign))
  )
}

/**
 * 批量处理 ack 请求
 */
export async function processBatchAck(
  userId: string,
  acks: SingleAckRequest[]
): Promise<SingleAckResult[]> {
  return Promise.all(
    acks.map(ack => processSingleAck(userId, ack))
  )
}
