/**
 * 清空库存数据脚本
 * 
 * 功能：
 * 1. 清空 SuffixStockItem 表（库存项）
 * 2. 清空 SuffixLease 表（租约）
 * 3. 清空 ProxyExitIpUsage 表（IP 使用记录）
 * 4. 清空 CampaignClickState 表（点击状态）
 * 
 * 运行方式：
 * npx ts-node scripts/clear-stock.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function clearStockData() {
  console.log('📦 开始清空库存数据...\n')
  
  try {
    // 1. 统计当前数据量
    const stockCount = await prisma.suffixStockItem.count()
    const leaseCount = await prisma.suffixLease.count()
    const ipUsageCount = await prisma.proxyExitIpUsage.count()
    const clickStateCount = await prisma.campaignClickState.count()
    
    console.log('当前数据量统计：')
    console.log(`  - SuffixStockItem: ${stockCount} 条`)
    console.log(`  - SuffixLease: ${leaseCount} 条`)
    console.log(`  - ProxyExitIpUsage: ${ipUsageCount} 条`)
    console.log(`  - CampaignClickState: ${clickStateCount} 条`)
    console.log('')
    
    // 2. 清空 SuffixLease 表（需要先清空，因为它依赖 SuffixStockItem）
    console.log('🗑️  清空 SuffixLease 表...')
    const deletedLeases = await prisma.suffixLease.deleteMany({})
    console.log(`   ✅ 已删除 ${deletedLeases.count} 条租约记录`)
    
    // 3. 清空 SuffixStockItem 表
    console.log('🗑️  清空 SuffixStockItem 表...')
    const deletedStock = await prisma.suffixStockItem.deleteMany({})
    console.log(`   ✅ 已删除 ${deletedStock.count} 条库存记录`)
    
    // 4. 清空 ProxyExitIpUsage 表
    console.log('🗑️  清空 ProxyExitIpUsage 表...')
    const deletedIpUsage = await prisma.proxyExitIpUsage.deleteMany({})
    console.log(`   ✅ 已删除 ${deletedIpUsage.count} 条 IP 使用记录`)
    
    // 5. 清空 CampaignClickState 表
    console.log('🗑️  清空 CampaignClickState 表...')
    const deletedClickState = await prisma.campaignClickState.deleteMany({})
    console.log(`   ✅ 已删除 ${deletedClickState.count} 条点击状态记录`)
    
    console.log('\n✅ 库存数据清空完成！')
    
    // 6. 验证清空结果
    console.log('\n📊 验证清空结果：')
    const newStockCount = await prisma.suffixStockItem.count()
    const newLeaseCount = await prisma.suffixLease.count()
    const newIpUsageCount = await prisma.proxyExitIpUsage.count()
    const newClickStateCount = await prisma.campaignClickState.count()
    
    console.log(`  - SuffixStockItem: ${newStockCount} 条`)
    console.log(`  - SuffixLease: ${newLeaseCount} 条`)
    console.log(`  - ProxyExitIpUsage: ${newIpUsageCount} 条`)
    console.log(`  - CampaignClickState: ${newClickStateCount} 条`)
    
  } catch (error) {
    console.error('❌ 清空库存数据失败:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// 执行清空
clearStockData()
  .then(() => {
    console.log('\n🎉 脚本执行完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('脚本执行失败:', error)
    process.exit(1)
  })

