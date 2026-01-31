/**
 * 验证测试数据脚本
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== 验证 Campaign 数据 ===')
  const campaigns = await prisma.campaignMeta.findMany({
    where: { deletedAt: null },
    select: {
      campaignId: true,
      campaignName: true,
      country: true,
      status: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  console.table(campaigns)

  console.log('\n=== 验证库存使用情况 ===')
  const stockStats = await prisma.suffixStockItem.groupBy({
    by: ['campaignId', 'status'],
    where: { deletedAt: null },
    _count: true,
  })
  console.table(stockStats.map(s => ({
    campaignId: s.campaignId,
    status: s.status,
    count: s._count,
  })))

  console.log('\n=== 验证租约状态 ===')
  const leases = await prisma.suffixLease.findMany({
    where: { deletedAt: null },
    select: {
      campaignId: true,
      status: true,
      applied: true,
      nowClicksAtLeaseTime: true,
    },
    orderBy: { leasedAt: 'asc' },
  })
  console.table(leases)

  console.log('\n=== 验证 ClickState ===')
  const clickStates = await prisma.campaignClickState.findMany({
    select: {
      campaignId: true,
      lastAppliedClicks: true,
      lastObservedClicks: true,
    },
  })
  console.table(clickStates)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

