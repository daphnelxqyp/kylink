/**
 * POST /v1/suffix/lease/batch
 * 
 * 批量请求换链决策 + 领取 suffix（PRD 5.2.1）
 * 
 * 核心逻辑：
 * - 每个 campaign 独立判定，互不影响
 * - 部分失败不影响其他 campaign 的结果返回
 * - 单次最多 100 条
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateRequest } from '@/lib/auth'
import { triggerReplenishAsync } from '@/lib/stock-producer'
import { 
  parseJsonBody, 
  validateRequired, 
  successResponse, 
  errorResponse,
  validateCycleMinutes,
} from '@/lib/utils'

// 单个 campaign 请求类型
interface CampaignLeaseRequest {
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

// 批量请求体类型
interface BatchLeaseRequest {
  campaigns: CampaignLeaseRequest[]
  scriptInstanceId: string
  cycleMinutes: number
}

// 单个 campaign 结果类型
interface CampaignLeaseResult {
  campaignId: string
  action?: 'APPLY' | 'NOOP'
  leaseId?: string
  finalUrlSuffix?: string
  reason?: string
  code?: string
  message?: string
}

/**
 * 处理单个 campaign 的 lease 逻辑
 */
async function processSingleLease(
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
    // 注意：使用 findFirst 而非 findUnique，因为需要同时过滤 deletedAt
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
    if (existingLease) {
      if (existingLease.status === 'leased') {
        return {
          campaignId,
          action: 'APPLY',
          leaseId: existingLease.id,
          finalUrlSuffix: existingLease.suffixStockItem.finalUrlSuffix,
          reason: '返回已存在的活跃租约（幂等）',
        }
      }
      return {
        campaignId,
        action: 'NOOP',
        reason: '该窗口租约已处理完成',
      }
    }

    // 2. 检查/创建 CampaignMeta（惰性同步）
    // 注意：使用 findFirst 而非 findUnique，因为需要同时过滤 deletedAt
    let campaignMeta = await prisma.campaignMeta.findFirst({
      where: {
        userId,
        campaignId,
        deletedAt: null,
      },
    })

    // 如果 campaign 不存在
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
    let delta = nowClicks - clickState.lastAppliedClicks

    // 5. 跨天检测：如果 delta <= 0 且看起来像是跨天重置
    // Google Ads 的 TODAY 点击数会在午夜重置为 0
    if (delta <= 0 && clickState.lastAppliedClicks > 0) {
      // 检查是否跨天：比较 lastObservedAt 的日期和今天的日期
      const today = new Date()
      const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD
      const lastObservedDate = clickState.lastObservedAt 
        ? clickState.lastObservedAt.toISOString().split('T')[0]
        : null

      // 如果 lastObservedAt 是昨天或更早，说明是跨天了，需要重置
      if (lastObservedDate && lastObservedDate < todayStr) {
        // 跨天重置：将 lastAppliedClicks 重置为 0
        await prisma.campaignClickState.update({
          where: {
            userId_campaignId: {
              userId,
              campaignId,
            },
          },
          data: {
            lastAppliedClicks: 0,
          },
        })
        // 重新计算 delta
        delta = nowClicks
        console.log(`[lease] Campaign ${campaignId}: 跨天重置 lastAppliedClicks (${clickState.lastAppliedClicks} -> 0), new delta=${delta}`)
      }
    }

    // 6. delta <= 0，返回 NOOP
    if (delta <= 0) {
      return {
        campaignId,
        action: 'NOOP',
        reason: `delta=${delta}，无需换链`,
      }
    }

    // 6. delta > 0，检查是否有活跃租约
    const activeLease = await prisma.suffixLease.findFirst({
      where: {
        userId,
        campaignId,
        status: 'leased',
        deletedAt: null,
      },
      include: {
        suffixStockItem: true,
      },
    })

    if (activeLease) {
      return {
        campaignId,
        action: 'APPLY',
        leaseId: activeLease.id,
        finalUrlSuffix: activeLease.suffixStockItem.finalUrlSuffix,
        reason: '返回已存在的活跃租约',
      }
    }

    // 7. 从库存获取一条可用的 suffix
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

    // 8. 创建租约（事务）
    const [newLease] = await prisma.$transaction([
      prisma.suffixLease.create({
        data: {
          userId,
          campaignId,
          suffixStockItemId: availableSuffix.id,
          idempotencyKey,
          nowClicksAtLeaseTime: nowClicks,
          windowStartEpochSeconds: BigInt(windowStartEpochSeconds),
          status: 'leased',
          leasedAt: new Date(),
        },
      }),
      prisma.suffixStockItem.update({
        where: { id: availableSuffix.id },
        data: {
          status: 'leased',
          leasedAt: new Date(),
        },
      }),
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
    console.error(`Lease error for campaign ${campaignId}:`, error)
    return {
      campaignId,
      code: 'INTERNAL_ERROR',
      message: '处理失败',
    }
  }
}

export async function POST(request: NextRequest) {
  // 1. 鉴权
  const authResult = await authenticateRequest(request)
  if (!authResult.success) {
    return errorResponse(
      authResult.error!.code,
      authResult.error!.message,
      authResult.error!.status
    )
  }
  const userId = authResult.userId!

  // 2. 解析请求体
  const { data, error: parseError } = await parseJsonBody<BatchLeaseRequest>(request)
  if (parseError || !data) {
    return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
  }

  // 3. 验证必填字段
  const { valid, missing } = validateRequired(data, [
    'campaigns',
    'scriptInstanceId',
    'cycleMinutes',
  ])
  if (!valid) {
    return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
  }

  // 4. 验证 campaigns 数组
  if (!Array.isArray(data.campaigns)) {
    return errorResponse('VALIDATION_ERROR', 'campaigns 必须是数组', 422)
  }

  if (data.campaigns.length === 0) {
    return errorResponse('VALIDATION_ERROR', 'campaigns 不能为空', 422)
  }

  if (data.campaigns.length > 100) {
    return errorResponse('VALIDATION_ERROR', 'campaigns 单次最多 100 条', 422)
  }

  // 5. 验证 cycleMinutes 范围
  if (!validateCycleMinutes(data.cycleMinutes)) {
    return errorResponse('VALIDATION_ERROR', 'cycleMinutes 必须在 10-60 之间', 422)
  }

  // 6. 验证每个 campaign 的必填字段
  for (const campaign of data.campaigns) {
    const campaignValid = validateRequired(campaign, [
      'campaignId',
      'nowClicks',
      'observedAt',
      'windowStartEpochSeconds',
      'idempotencyKey',
    ])
    if (!campaignValid.valid) {
      return errorResponse(
        'VALIDATION_ERROR',
        `campaign ${campaign.campaignId || 'unknown'} 缺少字段: ${campaignValid.missing.join(', ')}`,
        422
      )
    }
  }

  // 7. 并行处理所有 campaign
  const results: CampaignLeaseResult[] = await Promise.all(
    data.campaigns.map((campaign: CampaignLeaseRequest) => processSingleLease(userId, campaign))
  )

  // 8. 返回结果
  return successResponse({ results })
}

