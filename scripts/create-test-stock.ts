/**
 * 创建测试库存脚本
 * 
 * 运行方式: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/create-test-stock.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // 获取测试用户
  const user = await prisma.user.findFirst({
    where: {
      email: 'test@kyads.com',
      deletedAt: null,
    },
  })

  if (!user) {
    console.log('❌ 测试用户不存在，请先运行 create-test-user.ts')
    return
  }

  console.log('找到测试用户:', user.id)

  // 为 camp-001 创建库存
  const campaignId = 'camp-001'
  
  // 检查现有库存
  const existingStock = await prisma.suffixStockItem.count({
    where: {
      userId: user.id,
      campaignId,
      status: 'available',
      deletedAt: null,
    },
  })

  console.log(`当前 ${campaignId} 可用库存: ${existingStock}`)

  // 创建 5 条测试库存
  const stockItems = []
  for (let i = 1; i <= 5; i++) {
    stockItems.push({
      userId: user.id,
      campaignId,
      finalUrlSuffix: `gclid=test-suffix-${Date.now()}-${i}&utm_source=google&utm_medium=cpc`,
      status: 'available' as const,
      exitIp: `192.168.1.${100 + i}`,
    })
  }

  const created = await prisma.suffixStockItem.createMany({
    data: stockItems,
  })

  console.log(`✅ 成功创建 ${created.count} 条库存`)
  
  // 查询总库存
  const totalStock = await prisma.suffixStockItem.count({
    where: {
      userId: user.id,
      campaignId,
      status: 'available',
      deletedAt: null,
    },
  })

  console.log(`📦 ${campaignId} 当前可用库存: ${totalStock}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

