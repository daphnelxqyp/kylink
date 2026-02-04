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
  // 1. 计算今日时间范围（自然日：00:00 到当前时间）
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // 2. 并行查询所有需要的数据
  const [assignments, writeLogs, clickStates, campaigns] = await Promise.all([
    // 查询今日分配记录（按 Campaign 分组）
    prisma.suffixAssignment.groupBy({
      by: ['campaignId'],
      where: {
        userId,
        assignedAt: { gte: todayStart },
        deletedAt: null,
      },
      _count: { id: true },
      _max: { assignedAt: true },
    }),

    // 查询今日写入日志（按 Campaign 和结果分组）
    prisma.suffixWriteLog.groupBy({
      by: ['campaignId', 'writeSuccess'],
      where: {
        userId,
        reportedAt: { gte: todayStart },
        deletedAt: null,
      },
      _count: { id: true },
    }),

    // 查询所有 Campaign 的点击状态
    prisma.campaignClickState.findMany({
      where: { userId },
      select: {
        campaignId: true,
        lastObservedClicks: true,
      },
    }),

    // 查询 Campaign 元数据（获取名称）
    prisma.campaignMeta.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      select: {
        campaignId: true,
        campaignName: true,
      },
    }),
  ])

  // 3. 构建辅助 Map 用于快速查找
  const clickStateMap = new Map(
    clickStates.map(cs => [cs.campaignId, cs.lastObservedClicks || 0])
  )

  const campaignNameMap = new Map(
    campaigns.map(c => [c.campaignId, c.campaignName])
  )

  // 构建写入日志统计 Map：campaignId -> { success: number, failure: number }
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

  // 4. 聚合计算每个 Campaign 的统计数据
  const campaignStats: CampaignLinkChangeStat[] = assignments.map(assignment => {
    const campaignId = assignment.campaignId
    const todayAssignments = assignment._count.id
    const writeLog = writeLogMap.get(campaignId) || { success: 0, failure: 0 }
    const successCount = writeLog.success
    const failureCount = writeLog.failure

    // 计算成功率（如果换链次数为 0，成功率为 0）
    const successRate = todayAssignments > 0
      ? (successCount / todayAssignments) * 100
      : 0

    return {
      campaignId,
      campaignName: campaignNameMap.get(campaignId) || null,
      todayClicks: clickStateMap.get(campaignId) || 0,
      todayAssignments,
      successCount,
      failureCount,
      successRate: parseFloat(successRate.toFixed(1)), // 保留 1 位小数
      lastAssignedAt: assignment._max.assignedAt,
    }
  })

  // 5. 计算全局汇总统计
  const summary = {
    totalClicks: campaignStats.reduce((sum, stat) => sum + stat.todayClicks, 0),
    totalAssignments: campaignStats.reduce((sum, stat) => sum + stat.todayAssignments, 0),
    totalSuccess: campaignStats.reduce((sum, stat) => sum + stat.successCount, 0),
    successRate: 0, // 稍后计算
  }

  // 计算全局成功率
  summary.successRate = summary.totalAssignments > 0
    ? parseFloat(((summary.totalSuccess / summary.totalAssignments) * 100).toFixed(1))
    : 0

  return {
    summary,
    campaigns: campaignStats,
  }
}
