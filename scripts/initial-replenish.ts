/**
 * 首次补货脚本
 * 
 * 功能：
 * 1. 查询符合条件的 Campaign 总数
 *    - 状态已启用（active）
 *    - 国家不为空
 *    - 联盟链接不为空
 * 2. 对每个 Campaign 补货 10 条不同 IP 的 suffix
 * 3. 并发执行以提高性能
 * 
 * 运行方式：
 * npx ts-node --compiler-options '{"module":"commonjs"}' scripts/initial-replenish.ts
 * 
 * 可选参数：
 * npx ts-node --compiler-options '{"module":"commonjs"}' scripts/initial-replenish.ts --concurrency=10
 * npx ts-node --compiler-options '{"module":"commonjs"}' scripts/initial-replenish.ts --dry-run
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// 配置常量
const STOCK_CONFIG = {
  PRODUCE_BATCH_SIZE: 10,  // 每个 Campaign 补货数量
}

// 补货结果类型
interface ReplenishResult {
  campaignId: string
  userId: string
  previousCount: number
  producedCount: number
  currentCount: number
  status: 'success' | 'skipped' | 'error'
  message?: string
}

// 解析命令行参数
function parseArgs(): { concurrency: number; dryRun: boolean } {
  const args = process.argv.slice(2)
  let concurrency = 5  // 默认并发数
  let dryRun = false

  for (const arg of args) {
    if (arg.startsWith('--concurrency=')) {
      const value = parseInt(arg.split('=')[1], 10)
      if (!isNaN(value) && value > 0) {
        concurrency = value
      }
    } else if (arg === '--dry-run') {
      dryRun = true
    }
  }

  return { concurrency, dryRun }
}

/**
 * 获取符合补货条件的 Campaign 列表
 */
async function getEligibleCampaigns(): Promise<Array<{
  userId: string
  campaignId: string
  campaignName: string | null
  country: string | null
  affiliateLinkUrl: string
  affiliateLinkId: string
}>> {
  // 1. 查找所有符合基本条件的 campaign（状态启用 + 国家不为空）
  const campaigns = await prisma.campaignMeta.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      country: {
        not: null,
      },
      NOT: {
        country: '',
      },
    },
    select: {
      userId: true,
      campaignId: true,
      campaignName: true,
      country: true,
    },
  })

  // 2. 批量查询这些 campaign 是否有联盟链接
  const campaignIds = campaigns.map(c => c.campaignId)
  const userIds = [...new Set(campaigns.map(c => c.userId))]
  
  const affiliateLinks = await prisma.affiliateLink.findMany({
    where: {
      userId: { in: userIds },
      campaignId: { in: campaignIds },
      enabled: true,
      deletedAt: null,
      NOT: {
        url: '',
      },
    },
    select: {
      id: true,
      userId: true,
      campaignId: true,
      url: true,
    },
  })

  // 3. 构建联盟链接映射
  const affiliateLinkMap = new Map<string, { id: string; url: string }>()
  for (const al of affiliateLinks) {
    const key = `${al.userId}:${al.campaignId}`
    // 只保留第一个（最高优先级的）
    if (!affiliateLinkMap.has(key)) {
      affiliateLinkMap.set(key, { id: al.id, url: al.url })
    }
  }

  // 4. 过滤出有联盟链接的 campaign
  const eligibleCampaigns = campaigns
    .filter(c => affiliateLinkMap.has(`${c.userId}:${c.campaignId}`))
    .map(c => {
      const linkInfo = affiliateLinkMap.get(`${c.userId}:${c.campaignId}`)!
      return {
        ...c,
        affiliateLinkUrl: linkInfo.url,
        affiliateLinkId: linkInfo.id,
      }
    })

  return eligibleCampaigns
}

/**
 * 生成模拟的 finalUrlSuffix
 */
function generateMockSuffix(campaignId: string, index: number): {
  finalUrlSuffix: string
  exitIp: string
} {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 10)
  
  return {
    finalUrlSuffix: `gclid=init_${campaignId}_${timestamp}_${index}_${randomId}&utm_source=google&utm_medium=cpc&utm_campaign=${campaignId}&ky_ts=${timestamp}&ky_mode=initial`,
    exitIp: `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
  }
}

/**
 * 为单个 campaign 补货
 */
async function replenishCampaign(
  userId: string,
  campaignId: string,
  affiliateLinkId: string,
  forceReplenish: boolean = true
): Promise<ReplenishResult> {
  try {
    // 1. 检查当前库存
    const availableCount = await prisma.suffixStockItem.count({
      where: {
        userId,
        campaignId,
        status: 'available',
        deletedAt: null,
      },
    })

    // 2. 计算需要生产的数量
    const produceCount = forceReplenish 
      ? STOCK_CONFIG.PRODUCE_BATCH_SIZE 
      : Math.max(0, STOCK_CONFIG.PRODUCE_BATCH_SIZE - availableCount)

    if (produceCount === 0) {
      return {
        campaignId,
        userId,
        previousCount: availableCount,
        producedCount: 0,
        currentCount: availableCount,
        status: 'skipped',
        message: `库存充足（${availableCount} 条）`,
      }
    }

    // 3. 生成库存项（使用模拟数据，确保不同 IP）
    const usedIps = new Set<string>()
    const stockItems = []
    
    for (let i = 0; i < produceCount; i++) {
      let mock: { finalUrlSuffix: string; exitIp: string }
      let attempts = 0
      
      // 确保 IP 不重复
      do {
        mock = generateMockSuffix(campaignId, i + 1)
        attempts++
      } while (usedIps.has(mock.exitIp) && attempts < 100)
      
      usedIps.add(mock.exitIp)
      
      stockItems.push({
        userId,
        campaignId,
        finalUrlSuffix: mock.finalUrlSuffix,
        status: 'available' as const,
        exitIp: mock.exitIp,
        sourceAffiliateLinkId: affiliateLinkId,
      })
    }

    // 4. 批量创建库存
    const created = await prisma.suffixStockItem.createMany({
      data: stockItems,
    })

    // 5. 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'initial_replenish',
        resourceType: 'SuffixStockItem',
        resourceId: campaignId,
        metadata: {
          previousCount: availableCount,
          producedCount: created.count,
          mode: 'initial_batch',
        },
      },
    })

    return {
      campaignId,
      userId,
      previousCount: availableCount,
      producedCount: created.count,
      currentCount: availableCount + created.count,
      status: 'success',
      message: `成功补货 ${created.count} 条`,
    }

  } catch (error) {
    console.error(`Replenish error for campaign ${campaignId}:`, error)
    return {
      campaignId,
      userId,
      previousCount: 0,
      producedCount: 0,
      currentCount: 0,
      status: 'error',
      message: error instanceof Error ? error.message : '补货失败',
    }
  }
}

async function main() {
  const { concurrency, dryRun } = parseArgs()
  
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  📦 首次补货脚本')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('')

  try {
    // 1. 查询符合条件的 Campaign 总数
    console.log('📊 查询符合条件的 Campaign...')
    console.log('   筛选条件：')
    console.log('   - 状态已启用（active）')
    console.log('   - 国家不为空')
    console.log('   - 联盟链接不为空')
    console.log('')
    
    const eligibleCampaigns = await getEligibleCampaigns()
    
    console.log(`✅ 找到 ${eligibleCampaigns.length} 个符合条件的 Campaign`)
    console.log('')

    // 2. 显示 Campaign 详情
    if (eligibleCampaigns.length > 0) {
      console.log('📋 Campaign 列表：')
      console.log('───────────────────────────────────────────────────────────')
      
      // 按 userId 分组统计
      const userStats = new Map<string, number>()
      const countryStats = new Map<string, number>()
      
      for (const campaign of eligibleCampaigns) {
        const userCount = userStats.get(campaign.userId) || 0
        userStats.set(campaign.userId, userCount + 1)
        
        const country = campaign.country || 'Unknown'
        const countryCount = countryStats.get(country) || 0
        countryStats.set(country, countryCount + 1)
      }
      
      // 显示前 20 个 Campaign
      const displayCount = Math.min(eligibleCampaigns.length, 20)
      for (let i = 0; i < displayCount; i++) {
        const c = eligibleCampaigns[i]
        const name = c.campaignName ? c.campaignName.substring(0, 40) : 'N/A'
        console.log(`   ${i + 1}. [${c.country}] ${c.campaignId} - ${name}...`)
      }
      
      if (eligibleCampaigns.length > 20) {
        console.log(`   ... 还有 ${eligibleCampaigns.length - 20} 个 Campaign`)
      }
      
      console.log('')
      console.log('📊 统计信息：')
      console.log(`   - 用户数: ${userStats.size}`)
      console.log(`   - 国家分布:`)
      for (const [country, count] of countryStats.entries()) {
        console.log(`     · ${country}: ${count} 个`)
      }
      console.log('')
    }

    // 3. 检查当前库存状态
    console.log('📦 当前库存状态：')
    const stockCount = await prisma.suffixStockItem.count({
      where: { status: 'available', deletedAt: null },
    })
    const leasedCount = await prisma.suffixStockItem.count({
      where: { status: 'leased', deletedAt: null },
    })
    const consumedCount = await prisma.suffixStockItem.count({
      where: { status: 'consumed', deletedAt: null },
    })
    
    console.log(`   - 可用库存: ${stockCount} 条`)
    console.log(`   - 已租用: ${leasedCount} 条`)
    console.log(`   - 已消费: ${consumedCount} 条`)
    console.log('')

    // 4. 如果是 dry-run 模式，只显示信息不执行
    if (dryRun) {
      console.log('⚠️  DRY-RUN 模式：只显示信息，不执行补货')
      console.log('')
      console.log(`如果执行补货，将为 ${eligibleCampaigns.length} 个 Campaign 各补货 ${STOCK_CONFIG.PRODUCE_BATCH_SIZE} 条 suffix`)
      console.log(`预计新增库存: ${eligibleCampaigns.length * STOCK_CONFIG.PRODUCE_BATCH_SIZE} 条`)
      return
    }

    // 5. 执行并发补货
    if (eligibleCampaigns.length === 0) {
      console.log('⚠️  没有符合条件的 Campaign，无需补货')
      return
    }

    console.log('═══════════════════════════════════════════════════════════')
    console.log(`🚀 开始并发补货（并发数: ${concurrency}）`)
    console.log('═══════════════════════════════════════════════════════════')
    console.log('')

    const startTime = Date.now()
    const results: ReplenishResult[] = []
    let replenished = 0
    let skipped = 0
    let errors = 0

    // 分批并发执行
    const totalCampaigns = eligibleCampaigns.length
    for (let i = 0; i < totalCampaigns; i += concurrency) {
      const batch = eligibleCampaigns.slice(i, i + concurrency)
      const batchNumber = Math.floor(i / concurrency) + 1
      const totalBatches = Math.ceil(totalCampaigns / concurrency)
      
      console.log(`[批次 ${batchNumber}/${totalBatches}] 处理 ${batch.length} 个 Campaign...`)
      
      // 并发执行当前批次
      const batchResults = await Promise.all(
        batch.map(async (campaign) => {
          try {
            const result = await replenishCampaign(
              campaign.userId,
              campaign.campaignId,
              campaign.affiliateLinkId,
              true
            )
            return result
          } catch (error) {
            console.error(`[Error] Campaign ${campaign.campaignId}:`, error)
            return {
              campaignId: campaign.campaignId,
              userId: campaign.userId,
              previousCount: 0,
              producedCount: 0,
              currentCount: 0,
              status: 'error' as const,
              message: error instanceof Error ? error.message : '补货失败',
            }
          }
        })
      )

      // 统计当前批次结果
      for (const result of batchResults) {
        results.push(result)
        switch (result.status) {
          case 'success':
            replenished++
            console.log(`   ✅ ${result.campaignId}: +${result.producedCount} 条`)
            break
          case 'skipped':
            skipped++
            console.log(`   ⏭️  ${result.campaignId}: ${result.message}`)
            break
          case 'error':
            errors++
            console.log(`   ❌ ${result.campaignId}: ${result.message}`)
            break
        }
      }
      
      // 批次间添加短暂延迟
      if (i + concurrency < totalCampaigns) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log('')
    console.log('═══════════════════════════════════════════════════════════')
    console.log('  📊 补货完成报告')
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`   - 总耗时: ${duration} 秒`)
    console.log(`   - Campaign 总数: ${totalCampaigns}`)
    console.log(`   - 补货成功: ${replenished}`)
    console.log(`   - 跳过: ${skipped}`)
    console.log(`   - 失败: ${errors}`)
    console.log('')

    // 6. 显示最终库存状态
    console.log('📦 补货后库存状态：')
    const newStockCount = await prisma.suffixStockItem.count({
      where: { status: 'available', deletedAt: null },
    })
    console.log(`   - 可用库存: ${newStockCount} 条 (新增 ${newStockCount - stockCount} 条)`)
    console.log('')

  } catch (error) {
    console.error('❌ 脚本执行失败:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// 执行
main()
  .then(() => {
    console.log('🎉 脚本执行完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('脚本执行失败:', error)
    process.exit(1)
  })
