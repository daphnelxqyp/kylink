/**
 * 换链监控业务逻辑
 *
 * 职责：
 * 1. 查询今日换链统计数据
 * 2. 聚合计算成功率等指标
 * 3. 返回格式化的监控数据
 */

import { prisma } from './prisma'
import type { LinkChangeMonitoringData, CampaignLinkChangeStat } from '@/types/monitoring'

/**
 * 获取换链监控数据
 *
 * @param userId 用户 ID
 * @returns 监控数据（汇总统计 + Campaign 明细）
 */
export async function getLinkChangeMonitoring(userId: string): Promise<LinkChangeMonitoringData> {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // 1. 查询所有启用了联盟链接的 Campaign
  const enabledCampaigns = await prisma.affiliateLink.findMany({
    where: {
      userId,
      enabled: true,
      deletedAt: null,
    },
    select: {
      campaignId: true,
    },
    distinct: ['campaignId'],
  })

  const campaignIds = enabledCampaigns.map(link => link.campaignId)

  // 如果没有启用的 Campaign，直接返回空数据
  if (campaignIds.length === 0) {
    return {
      summary: {
        totalCampaigns: 0,
        totalClicks: 0,
        totalAssignments: 0,
        totalSuccess: 0,
        successRate: 0,
      },
      campaigns: [],
    }
  }

  // 2. 并行查询所有需要的数据
  const [assignments, writeLogs, clickStates, campaigns, historicalAssignments] = await Promise.all([
    // 今日分配记录
    prisma.suffixAssignment.groupBy({
      by: ['campaignId'],
      where: {
        userId,
        campaignId: { in: campaignIds },
        assignedAt: { gte: todayStart },
        deletedAt: null,
      },
      _count: { id: true },
    }),

    // 今日写入日志
    prisma.suffixWriteLog.groupBy({
      by: ['campaignId', 'writeSuccess'],
      where: {
        userId,
        campaignId: { in: campaignIds },
        reportedAt: { gte: todayStart },
        deletedAt: null,
      },
      _count: { id: true },
    }),

    // 点击状态（包含 todayClicks 和 updatedAt）
    prisma.campaignClickState.findMany({
      where: {
        userId,
        campaignId: { in: campaignIds },
      },
      select: {
        campaignId: true,
        todayClicks: true,
        updatedAt: true,
      },
    }),

    // Campaign 元数据
    prisma.campaignMeta.findMany({
      where: {
        userId,
        campaignId: { in: campaignIds },
        deletedAt: null,
      },
      select: {
        campaignId: true,
        campaignName: true,
      },
    }),

    // 历史最后一次换链时间（不限今日）
    prisma.suffixAssignment.groupBy({
      by: ['campaignId'],
      where: {
        userId,
        campaignId: { in: campaignIds },
        deletedAt: null,
      },
      _max: { assignedAt: true },
    }),
  ])

  // 3. 构建辅助 Map
  const clickStateMap = new Map(
    clickStates.map(cs => [cs.campaignId, {
      todayClicks: cs.todayClicks || 0,
      lastMonitoredAt: cs.updatedAt
    }])
  )

  const campaignNameMap = new Map(
    campaigns.map(c => [c.campaignId, c.campaignName])
  )

  const writeLogMap = new Map<string, { success: number; failure: number }>()
  for (const log of writeLogs) {
    if (!writeLogMap.has(log.campaignId)) {
      writeLogMap.set(log.campaignId, { success: 0, failure: 0 })
    }
    const stat = writeLogMap.get(log.campaignId)!
    if (log.writeSuccess) {
      stat.success = log._count.id
    } else {
      stat.failure = log._count.id
    }
  }

  const todayAssignmentMap = new Map(
    assignments.map(a => [a.campaignId, a._count.id])
  )

  const historicalAssignmentMap = new Map(
    historicalAssignments.map(a => [a.campaignId, a._max.assignedAt])
  )

  // 4. 为所有启用了联盟链接的 Campaign 构建统计数据
  const campaignStats: CampaignLinkChangeStat[] = campaignIds.map(campaignId => {
    const todayAssignments = todayAssignmentMap.get(campaignId) || 0
    const writeLog = writeLogMap.get(campaignId) || { success: 0, failure: 0 }
    const clickState = clickStateMap.get(campaignId) || { todayClicks: 0, lastMonitoredAt: null }

    // 成功率：今日无换链活动时为 null（前端显示 "-"）
    const successRate = todayAssignments > 0
      ? parseFloat(((writeLog.success / todayAssignments) * 100).toFixed(1))
      : null

    return {
      campaignId,
      campaignName: campaignNameMap.get(campaignId) || null,
      todayClicks: clickState.todayClicks,
      todayAssignments,
      successCount: writeLog.success,
      failureCount: writeLog.failure,
      successRate,
      lastAssignedAt: historicalAssignmentMap.get(campaignId) || null,
      lastMonitoredAt: clickState.lastMonitoredAt,
    }
  })

  // 5. 计算全局汇总统计
  const summary = {
    totalCampaigns: campaignIds.length,
    totalClicks: campaignStats.reduce((sum, stat) => sum + stat.todayClicks, 0),
    totalAssignments: campaignStats.reduce((sum, stat) => sum + stat.todayAssignments, 0),
    totalSuccess: campaignStats.reduce((sum, stat) => sum + stat.successCount, 0),
    successRate: 0,
  }

  summary.successRate = summary.totalAssignments > 0
    ? parseFloat(((summary.totalSuccess / summary.totalAssignments) * 100).toFixed(1))
    : 0

  return { summary, campaigns: campaignStats }
}
