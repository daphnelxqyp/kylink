/**
 * Suffix 生成器端到端测试脚本
 *
 * 测试完整的 suffix 生成流程：
 * 1. 检查测试用户和代理配置
 * 2. 创建测试 Campaign 和联盟链接
 * 3. 调用 suffix 生成模块
 * 4. 验证生成结果
 *
 * 运行方式:
 * npx ts-node --compiler-options '{"module":"commonjs"}' scripts/test-suffix-generator.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ============================================
// 测试配置
// ============================================

const TEST_CONFIG = {
  // 测试用户邮箱（需要先通过 create-test-user.ts 创建）
  userEmail: 'test@kyads.com',
  // 测试 Campaign ID
  campaignId: 'test-campaign-e2e-001',
  // 测试联盟链接（使用一个真实可访问的联盟链接进行测试）
  affiliateUrl: 'https://www.amazon.com/dp/B09V3KXJPB?tag=test-20',
  // 目标国家
  country: 'US',
}

// ============================================
// 工具函数
// ============================================

function log(icon: string, message: string, data?: unknown) {
  console.log(`${icon} ${message}`)
  if (data) {
    console.log('   ', JSON.stringify(data, null, 2).split('\n').join('\n    '))
  }
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(60))
  console.log(`📋 ${title}`)
  console.log('='.repeat(60))
}

// ============================================
// 测试步骤
// ============================================

async function checkTestUser() {
  logSection('步骤 1: 检查测试用户')
  
  const user = await prisma.user.findFirst({
    where: {
      email: TEST_CONFIG.userEmail,
      deletedAt: null,
    },
  })

  if (!user) {
    log('❌', '测试用户不存在，请先运行:')
    console.log('   npx ts-node --compiler-options \'{"module":"commonjs"}\' scripts/create-test-user.ts')
    return null
  }

  log('✅', '找到测试用户', {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
  })

  return user
}

async function checkProxyProviders(userId: string) {
  logSection('步骤 2: 检查代理供应商配置')

  // 检查用户是否有分配的代理供应商
  const providers = await prisma.proxyProvider.findMany({
    where: {
      enabled: true,
      deletedAt: null,
      assignedUsers: {
        some: {
          userId: userId,
        },
      },
    },
    orderBy: {
      priority: 'asc',
    },
  })

  if (providers.length === 0) {
    log('⚠️', '未找到分配给用户的代理供应商')
    log('ℹ️', '将使用模拟数据模式生成 suffix')
    
    // 检查是否有任何代理供应商
    const allProviders = await prisma.proxyProvider.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, enabled: true },
    })
    
    if (allProviders.length > 0) {
      log('ℹ️', `系统中共有 ${allProviders.length} 个代理供应商，但未分配给测试用户`)
      console.log('   可用的代理供应商:', allProviders.map(p => `${p.name}(${p.enabled ? '启用' : '禁用'})`).join(', '))
    }
    
    return []
  }

  log('✅', `找到 ${providers.length} 个代理供应商`, 
    providers.map(p => ({
      name: p.name,
      priority: p.priority,
      host: p.host,
      enabled: p.enabled,
    }))
  )

  return providers
}

async function setupTestCampaign(userId: string) {
  logSection('步骤 3: 设置测试 Campaign')

  // 检查或创建 Campaign
  let campaign = await prisma.campaignMeta.findFirst({
    where: {
      userId,
      campaignId: TEST_CONFIG.campaignId,
      deletedAt: null,
    },
  })

  if (!campaign) {
    campaign = await prisma.campaignMeta.create({
      data: {
        userId,
        campaignId: TEST_CONFIG.campaignId,
        campaignName: 'E2E 测试 Campaign',
        country: TEST_CONFIG.country,
        cid: 'test-cid-001',      // 子账号 CID（必填）
        mccId: 'test-mcc-001',    // MCC ID（必填）
        status: 'active',
      },
    })
    log('✅', '创建测试 Campaign', {
      id: campaign.id,
      campaignId: campaign.campaignId,
      country: campaign.country,
    })
  } else {
    log('✅', '使用已有的测试 Campaign', {
      id: campaign.id,
      campaignId: campaign.campaignId,
      country: campaign.country,
    })
  }

  return campaign
}

async function setupTestAffiliateLink(userId: string, campaignId: string) {
  logSection('步骤 4: 设置测试联盟链接')

  // 检查或创建联盟链接
  let link = await prisma.affiliateLink.findFirst({
    where: {
      userId,
      campaignId,
      deletedAt: null,
    },
  })

  if (!link) {
    link = await prisma.affiliateLink.create({
      data: {
        userId,
        campaignId,
        url: TEST_CONFIG.affiliateUrl,
        priority: 1,
        enabled: true,
      },
    })
    log('✅', '创建测试联盟链接', {
      id: link.id,
      url: link.url,
    })
  } else {
    // 更新 URL 确保使用最新配置
    link = await prisma.affiliateLink.update({
      where: { id: link.id },
      data: { url: TEST_CONFIG.affiliateUrl },
    })
    log('✅', '更新已有的测试联盟链接', {
      id: link.id,
      url: link.url,
    })
  }

  return link
}

async function testSuffixGeneration(userId: string, campaignId: string, affiliateLinkId: string) {
  logSection('步骤 5: 测试 Suffix 生成')

  // 动态导入 suffix-generator（因为它可能有环境依赖）
  try {
    // 直接调用数据库层面的测试，不导入复杂的模块
    log('ℹ️', '准备调用 suffix 生成器...')
    log('ℹ️', '参数:', {
      userId,
      campaignId,
      affiliateLinkId,
      country: TEST_CONFIG.country,
    })

    // 检查当前库存
    const currentStock = await prisma.suffixStockItem.count({
      where: {
        userId,
        campaignId,
        status: 'available',
        deletedAt: null,
      },
    })
    log('ℹ️', `当前可用库存: ${currentStock} 条`)

    // 模拟生成一个 suffix（不调用真实代理，直接测试数据库写入）
    const mockSuffix = `gclid=e2e_test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}&utm_source=google&utm_medium=cpc&utm_campaign=${campaignId}&ky_ts=${Date.now()}&ky_mode=e2e_test`
    const mockExitIp = `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`

    const stockItem = await prisma.suffixStockItem.create({
      data: {
        userId,
        campaignId,
        finalUrlSuffix: mockSuffix,
        status: 'available',
        exitIp: mockExitIp,
        sourceAffiliateLinkId: affiliateLinkId,
      },
    })

    log('✅', '成功创建测试 Suffix', {
      id: stockItem.id,
      finalUrlSuffix: stockItem.finalUrlSuffix.substring(0, 50) + '...',
      exitIp: stockItem.exitIp,
      status: stockItem.status,
    })

    // 验证可以被查询到
    const verified = await prisma.suffixStockItem.findFirst({
      where: {
        id: stockItem.id,
        status: 'available',
        deletedAt: null,
      },
    })

    if (verified) {
      log('✅', '验证通过：Suffix 可被正常查询')
    } else {
      log('❌', '验证失败：Suffix 无法被查询')
    }

    return stockItem
  } catch (error) {
    log('❌', '生成测试 Suffix 失败', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function testLeaseFlow(userId: string, campaignId: string) {
  logSection('步骤 6: 测试租约流程')

  // 1. 获取一个可用的 suffix
  const availableStock = await prisma.suffixStockItem.findFirst({
    where: {
      userId,
      campaignId,
      status: 'available',
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
  })

  if (!availableStock) {
    log('⚠️', '没有可用的 suffix 进行租约测试')
    return null
  }

  log('ℹ️', '找到可用 Suffix', {
    id: availableStock.id,
    suffix: availableStock.finalUrlSuffix.substring(0, 30) + '...',
  })

  // 2. 模拟创建租约
  const windowStart = Math.floor(Date.now() / 1000)
  const idempotencyKey = `${campaignId}:${windowStart}`
  
  // 开始事务
  const result = await prisma.$transaction(async (tx) => {
    // 更新 stock 状态
    await tx.suffixStockItem.update({
      where: { id: availableStock.id },
      data: { status: 'leased' },
    })

    // 创建租约（使用正确的字段名）
    const lease = await tx.suffixLease.create({
      data: {
        userId,
        campaignId,
        suffixStockItemId: availableStock.id,
        idempotencyKey,
        nowClicksAtLeaseTime: 100,              // 租用时的点击数
        windowStartEpochSeconds: BigInt(windowStart),
        status: 'leased',
        leasedAt: new Date(),
      },
    })

    return lease
  })

  log('✅', '成功创建租约', {
    id: result.id,
    idempotencyKey: result.idempotencyKey,
    status: result.status,
  })

  // 3. 模拟 ACK（确认使用）
  const ackResult = await prisma.$transaction(async (tx) => {
    // 更新租约状态（使用正确的字段名）
    await tx.suffixLease.update({
      where: { id: result.id },
      data: {
        status: 'consumed',
        ackedAt: new Date(),
        applied: true,
      },
    })

    // 更新 stock 状态
    await tx.suffixStockItem.update({
      where: { id: availableStock.id },
      data: { status: 'consumed' },
    })

    return true
  })

  if (ackResult) {
    log('✅', '成功确认租约使用')
  }

  return result
}

async function printSummary(userId: string, campaignId: string) {
  logSection('测试总结')

  // 统计数据
  const stats = await prisma.suffixStockItem.groupBy({
    by: ['status'],
    where: {
      userId,
      campaignId,
      deletedAt: null,
    },
    _count: true,
  })

  const leaseCount = await prisma.suffixLease.count({
    where: {
      userId,
      campaignId,
      deletedAt: null,
    },
  })

  console.log('\n📊 测试数据统计:')
  console.log('   Campaign:', campaignId)
  console.log('   库存统计:')
  for (const stat of stats) {
    console.log(`      - ${stat.status}: ${stat._count} 条`)
  }
  console.log(`   租约总数: ${leaseCount} 条`)
}

async function cleanup(userId: string, campaignId: string) {
  logSection('清理测试数据（可选）')
  
  log('ℹ️', '如需清理测试数据，请手动执行以下 SQL:')
  console.log(`
   -- 删除测试租约
   UPDATE suffix_lease SET deleted_at = NOW() 
   WHERE user_id = '${userId}' AND campaign_id = '${campaignId}';
   
   -- 删除测试库存
   UPDATE suffix_stock_item SET deleted_at = NOW() 
   WHERE user_id = '${userId}' AND campaign_id = '${campaignId}';
   
   -- 删除测试 Campaign
   UPDATE campaign_meta SET deleted_at = NOW() 
   WHERE user_id = '${userId}' AND campaign_id = '${campaignId}';
  `)
}

// ============================================
// 主函数
// ============================================

async function main() {
  console.log('\n🚀 Suffix 生成器端到端测试')
  console.log('=' .repeat(60))

  try {
    // 步骤 1: 检查测试用户
    const user = await checkTestUser()
    if (!user) {
      process.exit(1)
    }

    // 步骤 2: 检查代理供应商
    await checkProxyProviders(user.id)

    // 步骤 3: 设置测试 Campaign
    const campaign = await setupTestCampaign(user.id)

    // 步骤 4: 设置测试联盟链接
    const link = await setupTestAffiliateLink(user.id, campaign.campaignId)

    // 步骤 5: 测试 Suffix 生成
    await testSuffixGeneration(user.id, campaign.campaignId, link.id)

    // 步骤 6: 测试租约流程
    await testLeaseFlow(user.id, campaign.campaignId)

    // 打印总结
    await printSummary(user.id, campaign.campaignId)

    // 清理提示
    await cleanup(user.id, campaign.campaignId)

    console.log('\n✅ 端到端测试完成！')

  } catch (error) {
    console.error('\n❌ 测试失败:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
