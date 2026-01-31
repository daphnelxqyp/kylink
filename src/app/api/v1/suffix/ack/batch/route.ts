/**
 * POST /v1/suffix/ack/batch
 * 
 * 批量回执写入结果（PRD 5.2.2）
 * 
 * 核心逻辑：
 * - 每个租约独立处理，互不影响
 * - 部分失败不影响其他租约
 * - 单次最多 100 条
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateRequest } from '@/lib/auth'
import { 
  parseJsonBody, 
  validateRequired, 
  successResponse, 
  errorResponse,
} from '@/lib/utils'

// 单个 ack 请求类型
interface SingleAckRequest {
  leaseId: string
  campaignId: string
  applied: boolean
  appliedAt: string
  errorMessage?: string
}

// 批量请求体类型
interface BatchAckRequest {
  acks: SingleAckRequest[]
}

// 单个 ack 结果类型
interface SingleAckResult {
  leaseId: string
  ok: boolean
  message?: string
  previousStatus?: string
}

/**
 * 处理单个 ack 逻辑
 */
async function processSingleAck(
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
      // 写入失败：更新租约状态为 failed，立即释放库存回可用池
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

      console.log(`[BatchAck] Lease ${leaseId} failed, stock ${lease.suffixStockItemId} recovered to available`)

      return {
        leaseId,
        ok: true,
      }
    }

  } catch (error) {
    console.error(`Ack error for lease ${leaseId}:`, error)
    return {
      leaseId,
      ok: false,
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
  const { data, error: parseError } = await parseJsonBody<BatchAckRequest>(request)
  if (parseError || !data) {
    return errorResponse('VALIDATION_ERROR', parseError || '请求体解析失败', 422)
  }

  // 3. 验证必填字段
  const { valid, missing } = validateRequired(data, ['acks'])
  if (!valid) {
    return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
  }

  // 4. 验证 acks 数组
  if (!Array.isArray(data.acks)) {
    return errorResponse('VALIDATION_ERROR', 'acks 必须是数组', 422)
  }

  if (data.acks.length === 0) {
    return errorResponse('VALIDATION_ERROR', 'acks 不能为空', 422)
  }

  if (data.acks.length > 100) {
    return errorResponse('VALIDATION_ERROR', 'acks 单次最多 100 条', 422)
  }

  // 5. 验证每个 ack 的必填字段
  for (const ack of data.acks) {
    const ackValid = validateRequired(ack, [
      'leaseId',
      'campaignId',
      'applied',
      'appliedAt',
    ])
    if (!ackValid.valid) {
      return errorResponse(
        'VALIDATION_ERROR',
        `ack ${ack.leaseId || 'unknown'} 缺少字段: ${ackValid.missing.join(', ')}`,
        422
      )
    }
  }

  // 6. 并行处理所有 ack
  const results: SingleAckResult[] = await Promise.all(
    data.acks.map(ack => processSingleAck(userId, ack))
  )

  // 7. 返回结果
  return successResponse({ results })
}

