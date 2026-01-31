/**
 * 通过 API 调用进行首次补货
 * 
 * 功能：
 * 1. 获取符合条件的 Campaign 列表
 * 2. 通过 API 逐个调用补货
 * 3. 使用真实的代理进行 suffix 生成
 * 
 * 运行前提：
 * 1. 开发服务器必须运行在 http://localhost:51001
 * 2. 需要配置有效的 API Key 或使用直接数据库方式
 * 
 * 运行方式：
 * npx ts-node --compiler-options '{"module":"commonjs"}' scripts/api-replenish.ts
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'crypto'

const prisma = new PrismaClient()

// API 配置
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:51001'

// 生成新的 API Key
// 格式：ky_test_ (8字符) + 32位随机字符 = 40字符总长度
function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const randomPart = crypto.randomBytes(16).toString('hex') // 16字节 = 32个十六进制字符
  const raw = `ky_test_${randomPart}`
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const prefix = raw.substring(0, 12)
  return { raw, hash, prefix }
}

// 发起 API 请求
async function callApi(endpoint: string, method: string, body?: object, apiKey?: string): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  
  return response.json()
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  📦 通过 API 调用进行首次补货')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('')
  console.log(`🌐 API 地址: ${API_BASE_URL}`)
  console.log('')

  try {
    // 1. 获取测试用户
    const user = await prisma.user.findFirst({
      where: { email: 'test@kyads.com', deletedAt: null },
    })
    
    if (!user) {
      console.log('❌ 找不到测试用户 test@kyads.com')
      return
    }
    
    console.log(`📌 用户: ${user.email}`)
    
    // 2. 为用户创建临时 API Key（用于本次补货）
    console.log('🔑 创建临时 API Key...')
    const newKey = generateApiKey()
    
    // 更新用户的 API Key
    await prisma.user.update({
      where: { id: user.id },
      data: {
        apiKeyHash: newKey.hash,
        apiKeyPrefix: newKey.prefix,
        apiKeyCreatedAt: new Date(),
      },
    })
    
    console.log(`   API Key: ${newKey.raw.substring(0, 20)}...`)
    console.log('')
    
    // 3. 获取符合条件的 Campaign 列表
    console.log('📊 查询符合条件的 Campaign...')
    
    const campaigns = await prisma.campaignMeta.findMany({
      where: {
        userId: user.id,
        status: 'active',
        deletedAt: null,
        country: { not: null },
        NOT: { country: '' },
      },
      select: { campaignId: true, campaignName: true, country: true },
    })
    
    // 过滤有联盟链接的 Campaign
    const affiliateLinks = await prisma.affiliateLink.findMany({
      where: {
        userId: user.id,
        campaignId: { in: campaigns.map(c => c.campaignId) },
        enabled: true,
        deletedAt: null,
        NOT: { url: '' },
      },
      select: { campaignId: true },
    })
    
    const linkedCampaignIds = new Set(affiliateLinks.map(al => al.campaignId))
    const eligibleCampaigns = campaigns.filter(c => linkedCampaignIds.has(c.campaignId))
    
    console.log(`✅ 找到 ${eligibleCampaigns.length} 个符合条件的 Campaign`)
    console.log('')
    
    if (eligibleCampaigns.length === 0) {
      console.log('⚠️  没有符合条件的 Campaign，无需补货')
      return
    }
    
    // 4. 检查当前库存
    console.log('📦 当前库存状态：')
    const stockCount = await prisma.suffixStockItem.count({
      where: { userId: user.id, status: 'available', deletedAt: null },
    })
    console.log(`   可用库存: ${stockCount} 条`)
    console.log('')
    
    // 5. 逐个调用 API 补货
    console.log('═══════════════════════════════════════════════════════════')
    console.log('🚀 开始通过 API 补货...')
    console.log('═══════════════════════════════════════════════════════════')
    console.log('')
    
    const startTime = Date.now()
    let successCount = 0
    let errorCount = 0
    
    for (let i = 0; i < eligibleCampaigns.length; i++) {
      const campaign = eligibleCampaigns[i]
      console.log(`[${i + 1}/${eligibleCampaigns.length}] Campaign ${campaign.campaignId} (${campaign.country})`)
      
      try {
        const result = await callApi('/api/v1/jobs/replenish', 'POST', {
          mode: 'single',
          campaignId: campaign.campaignId,
          force: true,
        }, newKey.raw) as { success: boolean; result?: { producedCount?: number; message?: string }; error?: { message?: string } }
        
        if (result.success && result.result) {
          console.log(`   ✅ 成功: +${result.result.producedCount || 0} 条`)
          successCount++
        } else {
          console.log(`   ❌ 失败: ${result.error?.message || '未知错误'}`)
          errorCount++
        }
      } catch (err) {
        console.log(`   ❌ 请求失败: ${err instanceof Error ? err.message : err}`)
        errorCount++
      }
      
      // 添加延迟，避免请求过快
      if (i < eligibleCampaigns.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    
    console.log('')
    console.log('═══════════════════════════════════════════════════════════')
    console.log('  📊 补货完成报告')
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`   - 总耗时: ${duration} 秒`)
    console.log(`   - Campaign 总数: ${eligibleCampaigns.length}`)
    console.log(`   - 成功: ${successCount}`)
    console.log(`   - 失败: ${errorCount}`)
    console.log('')
    
    // 6. 检查最终库存状态
    console.log('📦 补货后库存状态：')
    const newStockCount = await prisma.suffixStockItem.count({
      where: { userId: user.id, status: 'available', deletedAt: null },
    })
    console.log(`   可用库存: ${newStockCount} 条 (新增 ${newStockCount - stockCount} 条)`)
    
    // 7. 检查是否有真实数据
    const realSuffixes = await prisma.suffixStockItem.count({
      where: {
        userId: user.id,
        deletedAt: null,
        NOT: {
          OR: [
            { finalUrlSuffix: { contains: 'ky_mode=mock' } },
            { finalUrlSuffix: { contains: 'ky_mode=initial' } },
            { finalUrlSuffix: { contains: 'gclid=init_' } },
            { finalUrlSuffix: { contains: 'gclid=mock_' } },
          ],
        },
      },
    })
    
    console.log(`   真实代理数据: ${realSuffixes} 条`)
    
    const ipUsageCount = await prisma.proxyExitIpUsage.count({
      where: { userId: user.id },
    })
    console.log(`   IP 使用记录: ${ipUsageCount} 条`)
    
  } catch (error) {
    console.error('❌ 脚本执行失败:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then(() => {
    console.log('\n🎉 脚本执行完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('脚本执行失败:', error)
    process.exit(1)
  })

