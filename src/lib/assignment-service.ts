/**
 * Assignment 服务层（新架构）
 *
 * 简化的分配-回传逻辑，去掉 ACK 回执步骤
 * 核心改进：
 * 1. 分配时直接标记为 consumed（无需 ACK）
 * 2. 状态流转简化：available → consumed
 * 3. 回传仅记录写入结果日志
 */

import prisma from './prisma'
import { triggerReplenishAsync } from './stock-producer'

// ============================================
// 并发重试配置
// ============================================

/** 最大重试次数 */
const MAX_RETRIES = 3
/** 基础重试延迟（毫秒） */
const BASE_RETRY_DELAY_MS = 50

/**
 * 检查是否是并发冲突错误（MySQL 1020）
 */
function isConcurrencyError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message
    // MySQL 错误码 1020: Record has changed since last read
    return message.includes('Record has changed since last read') ||
           message.includes('code: 1020')
  }
  return false
}

/**
 * 随机延迟（避免重试雷同）
 */
function randomDelay(baseMs: number): Promise<void> {
  const jitter = Math.random() * baseMs
  return new Promise(resolve => setTimeout(resolve, baseMs + jitter))
}

// ============================================
// 类型定义
// ============================================

/**
 * 单个 Campaign 分配请求
 */
export interface CampaignAssignmentRequest {
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
 * 单个 Campaign 分配结果
 */
export interface CampaignAssignmentResult {
  campaignId: string
  action?: 'APPLY' | 'NOOP'
  assignmentId?: string
  finalUrlSuffix?: string
  reason?: string
  code?: string
  message?: string
}

/**
 * 单个回传请求
 */
export interface SingleReportRequest {
  assignmentId: string
  campaignId: string
  writeSuccess: boolean
  writeErrorMessage?: string
  reportedAt: string
}

/**
 * 单个回传结果
 */
export interface SingleReportResult {
  assignmentId: string
  ok: boolean
  message?: string
}

// ============================================
// Assignment 核心逻辑
// ============================================

/**
 * 处理单个 campaign 的分配逻辑
 *
 * 核心流程：
 * 1. 检查幂等：是否已有相同 idempotencyKey 的分配
 * 2. 检查/创建 CampaignMeta（惰性同步）
 * 3. 获取/创建 CampaignClickState
 * 4. 计算 delta = nowClicks - lastAppliedClicks
 * 5. delta <= 0 返回 NOOP
 * 6. delta > 0 分配库存并立即标记为 consumed
 * 7. 事务：创建 SuffixAssignment + 更新 SuffixStockItem + 更新 lastAppliedClicks
 * 8. 异步触发库存补货检查
 *
 * 并发处理：
 * - 使用重试机制处理 MySQL 乐观锁冲突（错误码 1020）
 * - 最多重试 3 次，每次重试前随机延迟
 */
export async function processSingleAssignment(
  userId: string,
  campaign: CampaignAssignmentRequest
): Promise<CampaignAssignmentResult> {
  const {
    campaignId,
    nowClicks,
    observedAt,
    windowStartEpochSeconds,
    idempotencyKey,
    meta,
  } = campaign

  let lastError: unknown = null

  // 重试循环，处理并发冲突
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await processSingleAssignmentInternal(
        userId,
        campaignId,
        nowClicks,
        observedAt,
        windowStartEpochSeconds,
        idempotencyKey,
        meta
      )
    } catch (error) {
      lastError = error
      
      // 如果是并发冲突错误，重试
      if (isConcurrencyError(error) && attempt < MAX_RETRIES) {
        console.log(`[AssignmentService] Concurrency conflict for campaign ${campaignId}, retry ${attempt}/${MAX_RETRIES}`)
        await randomDelay(BASE_RETRY_DELAY_MS * attempt)
        continue
      }
      
      // 其他错误或重试次数用完，退出循环
      break
    }
  }

  // 所有重试都失败
  console.error(`[AssignmentService] Assignment error for campaign ${campaignId} after ${MAX_RETRIES} retries:`, lastError)
  return {
    campaignId,
    code: 'INTERNAL_ERROR',
    message: '处理失败',
  }
}

/**
 * 内部分配逻辑（可重试）
 */
async function processSingleAssignmentInternal(
  userId: string,
  campaignId: string,
  nowClicks: number,
  observedAt: string,
  windowStartEpochSeconds: number,
  idempotencyKey: string,
  meta?: {
    campaignName: string
    country: string
    finalUrl: string
    cid: string
    mccId: string
  }
): Promise<CampaignAssignmentResult> {
  try {
    // 1. 检查幂等：是否已有相同 idempotencyKey 的分配
    const existingAssignment = await prisma.suffixAssignment.findFirst({
      where: {
        userId,
        idempotencyKey,
        deletedAt: null,
      },
    })

    // 如果已存在分配，直接返回（幂等）
    if (existingAssignment) {
      return {
        campaignId,
        action: 'APPLY',
        assignmentId: existingAssignment.id,
        finalUrlSuffix: existingAssignment.finalUrlSuffix,
        reason: '返回已存在的分配记录（幂等）',
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

    // 6. 从库存获取一条可用的 suffix
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

    // 7. 创建分配记录并立即标记库存为 consumed（事务）
    const [newAssignment] = await prisma.$transaction([
      // 创建分配记录
      prisma.suffixAssignment.create({
        data: {
          userId,
          campaignId,
          suffixStockItemId: availableSuffix.id,
          finalUrlSuffix: availableSuffix.finalUrlSuffix,
          nowClicksAtAssignTime: nowClicks,
          idempotencyKey,
          windowStartEpochSeconds: BigInt(windowStartEpochSeconds),
          assignedAt: new Date(),
        },
      }),
      // 立即标记库存为 consumed
      prisma.suffixStockItem.update({
        where: { id: availableSuffix.id },
        data: {
          status: 'consumed',
          consumedAt: new Date(),
        },
      }),
      // 更新 lastAppliedClicks（使用 GREATEST 确保单调递增）
      prisma.$executeRaw`
        UPDATE CampaignClickState
        SET lastAppliedClicks = GREATEST(lastAppliedClicks, ${nowClicks}),
            updatedAt = NOW()
        WHERE userId = ${userId} AND campaignId = ${campaignId}
      `,
    ])

    // 8. 异步检查库存水位，必要时补货
    triggerReplenishAsync(userId, campaignId)

    return {
      campaignId,
      action: 'APPLY',
      assignmentId: newAssignment.id,
      finalUrlSuffix: availableSuffix.finalUrlSuffix,
      reason: `delta=${delta}，分配新 suffix`,
    }
  } catch (error) {
    // 重新抛出错误，让外层重试循环处理
    throw error
  }
}

// ============================================
// Report 核心逻辑
// ============================================

/**
 * 处理单个回传逻辑
 *
 * 核心流程：
 * 1. 查找分配记录
 * 2. 幂等检查：是否已有写入日志
 * 3. 创建 SuffixWriteLog 记录
 *
 * 注意：无论写入成功或失败，都只记录日志，不改变库存状态
 */
export async function processSingleReport(
  userId: string,
  report: SingleReportRequest
): Promise<SingleReportResult> {
  const { assignmentId, campaignId, writeSuccess, writeErrorMessage, reportedAt } = report

  try {
    // 1. 查找分配记录
    const assignment = await prisma.suffixAssignment.findFirst({
      where: {
        id: assignmentId,
        userId,
        campaignId,
        deletedAt: null,
      },
    })

    // 分配记录不存在
    if (!assignment) {
      return {
        assignmentId,
        ok: false,
        message: '分配记录不存在或无权访问',
      }
    }

    // 2. 幂等检查：是否已有写入日志
    const existingLog = await prisma.suffixWriteLog.findUnique({
      where: {
        assignmentId,
      },
    })

    if (existingLog) {
      return {
        assignmentId,
        ok: true,
        message: '写入日志已存在（幂等）',
      }
    }

    // 3. 创建写入日志
    await prisma.suffixWriteLog.create({
      data: {
        assignmentId,
        userId,
        campaignId,
        writeSuccess,
        writeErrorMessage: writeErrorMessage || null,
        reportedAt: new Date(reportedAt),
      },
    })

    return {
      assignmentId,
      ok: true,
    }
  } catch (error) {
    console.error(`[AssignmentService] Report error for assignment ${assignmentId}:`, error)
    return {
      assignmentId,
      ok: false,
      message: '处理失败',
    }
  }
}

// ============================================
// 批量处理
// ============================================

/**
 * 批量处理分配请求
 */
export async function processBatchAssignment(
  userId: string,
  campaigns: CampaignAssignmentRequest[]
): Promise<CampaignAssignmentResult[]> {
  return Promise.all(
    campaigns.map(campaign => processSingleAssignment(userId, campaign))
  )
}

/**
 * 批量处理回传请求
 */
export async function processBatchReport(
  userId: string,
  reports: SingleReportRequest[]
): Promise<SingleReportResult[]> {
  return Promise.all(
    reports.map(report => processSingleReport(userId, report))
  )
}
