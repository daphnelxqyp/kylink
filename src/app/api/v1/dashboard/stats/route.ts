/**
 * GET /api/v1/dashboard/stats
 *
 * 员工概览统计接口
 * 返回当前用户的今日换链、写入成功率、点击概览等数据
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateRequest } from '@/lib/auth'
import { successResponse, errorResponse } from '@/lib/utils'

/** 最近换链记录项 */
interface RecentAssignmentItem {
  id: string
  campaignId: string
  campaignName: string | null
  finalUrlSuffix: string
  assignedAt: string
  writeSuccess: boolean | null
}

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

  const userId = authResult.userId!

  try {
    // 计算今日零点（服务器本地时区）
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // 并行查询所有统计数据
    const [
      totalCampaigns,
      todayAssignments,
      todayWriteTotal,
      todayWriteSuccess,
      clickStates,
      stockAvailable,
      stockConsumed,
      lowStockCampaigns,
      recentAssignments,
    ] = await Promise.all([
      // 1. 广告系列总数（有启用联盟链接的）
      prisma.affiliateLink.findMany({
        where: { userId, enabled: true, url: { not: '' }, deletedAt: null },
        select: { campaignId: true },
        distinct: ['campaignId'],
      }).then(links => links.length),

      // 2. 今日换链次数
      prisma.suffixAssignment.count({
        where: {
          userId,
          assignedAt: { gte: todayStart },
          deletedAt: null,
        },
      }),

      // 3. 今日回传总数
      prisma.suffixWriteLog.count({
        where: {
          userId,
          reportedAt: { gte: todayStart },
          deletedAt: null,
        },
      }),

      // 4. 今日写入成功数
      prisma.suffixWriteLog.count({
        where: {
          userId,
          reportedAt: { gte: todayStart },
          writeSuccess: true,
          deletedAt: null,
        },
      }),

      // 5. 点击状态汇总
      prisma.campaignClickState.findMany({
        where: { userId },
        select: {
          lastObservedClicks: true,
          lastAppliedClicks: true,
        },
      }),

      // 6. 可用库存总数
      prisma.suffixStockItem.count({
        where: { userId, status: 'available', deletedAt: null },
      }),

      // 7. 已消耗库存总数
      prisma.suffixStockItem.count({
        where: { userId, status: 'consumed', deletedAt: null },
      }),

      // 8. 低库存 Campaign 数 — 查库存 < 3 或无库存的有联盟链接 Campaign
      (async () => {
        // 获取有联盟链接的 campaign 列表
        const eligibleLinks = await prisma.affiliateLink.findMany({
          where: { userId, enabled: true, url: { not: '' }, deletedAt: null },
          select: { campaignId: true },
          distinct: ['campaignId'],
        })
        if (eligibleLinks.length === 0) return 0

        const campaignIds = eligibleLinks.map(l => l.campaignId)

        // 统计每个 campaign 的可用库存
        const stockCounts = await prisma.suffixStockItem.groupBy({
          by: ['campaignId'],
          where: {
            userId,
            campaignId: { in: campaignIds },
            status: 'available',
            deletedAt: null,
          },
          _count: { id: true },
        })

        const stockMap = new Map(
          stockCounts.map(s => [s.campaignId, (s._count as { id: number }).id])
        )

        // 库存 < 3 的算低库存
        let lowCount = 0
        for (const cId of campaignIds) {
          if ((stockMap.get(cId) || 0) < 3) lowCount++
        }
        return lowCount
      })(),

      // 9. 最近换链记录 Top 10
      (async () => {
        const assignments = await prisma.suffixAssignment.findMany({
          where: { userId, deletedAt: null },
          orderBy: { assignedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            campaignId: true,
            finalUrlSuffix: true,
            assignedAt: true,
            writeLog: {
              select: { writeSuccess: true },
            },
          },
        })

        // 批量获取 campaignName
        const campaignIds = [...new Set(assignments.map(a => a.campaignId))]
        const metas = await prisma.campaignMeta.findMany({
          where: { userId, campaignId: { in: campaignIds }, deletedAt: null },
          select: { campaignId: true, campaignName: true },
        })
        const nameMap = new Map(metas.map(m => [m.campaignId, m.campaignName]))

        return assignments.map((a): RecentAssignmentItem => ({
          id: a.id,
          campaignId: a.campaignId,
          campaignName: nameMap.get(a.campaignId) || null,
          finalUrlSuffix: a.finalUrlSuffix,
          assignedAt: a.assignedAt.toISOString(),
          writeSuccess: a.writeLog?.writeSuccess ?? null,
        }))
      })(),
    ])

    // 汇总点击数据
    const totalObservedClicks = clickStates.reduce(
      (sum, s) => sum + (s.lastObservedClicks || 0), 0
    )
    const totalAppliedClicks = clickStates.reduce(
      (sum, s) => sum + (s.lastAppliedClicks || 0), 0
    )

    // 写入成功率（百分比，保留 1 位小数）
    const writeSuccessRate = todayWriteTotal > 0
      ? Math.round((todayWriteSuccess / todayWriteTotal) * 1000) / 10
      : null

    return successResponse({
      // 核心卡片
      totalCampaigns,
      todayAssignments,
      writeSuccessRate,
      todayWriteTotal,
      todayWriteSuccess,
      lowStockCampaigns,
      // 库存概览
      stockAvailable,
      stockConsumed,
      // 点击概览
      totalObservedClicks,
      totalAppliedClicks,
      // 最近换链记录
      recentAssignments,
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return errorResponse('INTERNAL_ERROR', '获取概览数据失败', 500)
  }
}
