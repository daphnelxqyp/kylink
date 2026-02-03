/**
 * 库存补货模块
 * 
 * 职责：
 * 1. 检测低水位库存
 * 2. 生产新的 suffix 库存
 * 3. 支持实时触发和定时批量补货
 * 
 * PRD 配置：
 * - produceBatchSize = 10（单次生产数量）
 * - lowWatermark = 3（低水位阈值）
 * 
 * 性能配置：
 * - STOCK_CONCURRENCY: 单个 Campaign 并发生成数（默认 5）
 * - CAMPAIGN_CONCURRENCY: 批量补货时 Campaign 并发数（默认 3）
 */

import prisma from './prisma'
import { STOCK_CONFIG, DYNAMIC_WATERMARK_CONFIG } from './utils'
import { generateSuffix, isProxyServiceAvailable } from './suffix-generator'

// ============================================
// 环境变量配置
// ============================================

/**
 * 是否允许在无代理时使用模拟数据
 * 生产环境应设置为 false，开发环境可设置为 true
 */
const ALLOW_MOCK_SUFFIX = process.env.ALLOW_MOCK_SUFFIX === 'true'

// ============================================
// 并发控制配置
// ============================================

/**
 * 单个 Campaign 内生成 suffix 的并发数
 * 建议值：2vCPU/2G=5, 2vCPU/4G=10, 4vCPU/8G=15
 */
const STOCK_CONCURRENCY = parseInt(process.env.STOCK_CONCURRENCY || '5', 10)

/**
 * 批量补货时 Campaign 的并发数
 * 建议值：2vCPU/2G=2, 2vCPU/4G=3, 4vCPU/8G=5
 */
const CAMPAIGN_CONCURRENCY = parseInt(process.env.CAMPAIGN_CONCURRENCY || '3', 10)

// ============================================
// 并发控制工具
// ============================================

/**
 * 创建并发限制器
 * 类似 p-limit，控制同时执行的 Promise 数量
 */
function createConcurrencyLimiter(concurrency: number) {
  const queue: Array<() => void> = []
  let activeCount = 0

  const next = () => {
    activeCount--
    if (queue.length > 0) {
      const fn = queue.shift()!
      fn()
    }
  }

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        activeCount++
        try {
          const result = await fn()
          resolve(result)
        } catch (error) {
          reject(error)
        } finally {
          next()
        }
      }

      if (activeCount < concurrency) {
        run()
      } else {
        queue.push(run)
      }
    })
  }
}

// 补货结果类型
export interface ReplenishResult {
  campaignId: string
  userId: string
  previousCount: number
  producedCount: number
  currentCount: number
  status: 'success' | 'skipped' | 'error'
  message?: string
}

// 批量补货结果
export interface BatchReplenishResult {
  totalCampaigns: number
  replenished: number
  skipped: number
  errors: number
  details: ReplenishResult[]
}

/**
 * 计算 campaign 的动态低水位
 * 基于过去 24 小时的消费速率
 *
 * 算法：
 * 1. 统计过去 24h 消费数量
 * 2. 计算每小时平均消费 = consumed24h / 24
 * 3. 动态水位 = ceil(avgPerHour * 2) 至少 2 小时缓冲
 * 4. 应用边界：最低 3，最高 20
 *
 * 边缘情况：
 * - 新 campaign（无消费历史）→ 返回默认水位 5
 * - 数据库错误 → 返回最低水位 3
 *
 * @param userId 用户 ID
 * @param campaignId Campaign ID
 * @returns 动态计算的水位值（3-20）
 */
export async function calculateDynamicWatermark(
  userId: string,
  campaignId: string
): Promise<number> {
  try {
    // 1. 计算时间窗口起点
    const windowStart = new Date(
      Date.now() - DYNAMIC_WATERMARK_CONFIG.HISTORY_WINDOW_HOURS * 60 * 60 * 1000
    )

    // 2. 查询过去 24 小时的消费数量
    const consumed24h = await prisma.suffixStockItem.count({
      where: {
        userId,
        campaignId,
        status: 'consumed',
        consumedAt: { gte: windowStart },
        deletedAt: null,
      },
    })

    // 3. 新 campaign（无消费历史）
    if (consumed24h === 0) {
      console.log(
        `[DynamicWatermark] ${campaignId}: No consumption history, using default watermark ${DYNAMIC_WATERMARK_CONFIG.DEFAULT_WATERMARK}`
      )
      return DYNAMIC_WATERMARK_CONFIG.DEFAULT_WATERMARK
    }

    // 4. 计算动态水位
    const avgPerHour = consumed24h / DYNAMIC_WATERMARK_CONFIG.HISTORY_WINDOW_HOURS
    const dynamicWatermark = Math.ceil(avgPerHour * DYNAMIC_WATERMARK_CONFIG.SAFETY_FACTOR)

    // 5. 应用边界
    const finalWatermark = Math.max(
      DYNAMIC_WATERMARK_CONFIG.MIN_WATERMARK,
      Math.min(dynamicWatermark, DYNAMIC_WATERMARK_CONFIG.MAX_WATERMARK)
    )

    // 6. 记录日志
    console.log(
      `[DynamicWatermark] ${campaignId}: consumed24h=${consumed24h}, ` +
      `avgPerHour=${avgPerHour.toFixed(2)}, watermark=${finalWatermark}`
    )

    return finalWatermark

  } catch (error) {
    console.error(`[DynamicWatermark] Error calculating for ${campaignId}:`, error)
    // 出错时回退到固定最低水位
    return DYNAMIC_WATERMARK_CONFIG.MIN_WATERMARK
  }
}

/**
 * 生成模拟的 finalUrlSuffix
 * 
 * 注意：实际生产环境需要：
 * 1. 调用代理服务获取出口 IP
 * 2. 访问联盟链接生成跳转追踪
 * 3. 构建最终的 suffix 参数
 * 
 * 这里使用模拟数据，后续需要对接真实的代理和联盟链接服务
 */
function generateMockSuffix(campaignId: string, index: number): {
  finalUrlSuffix: string
  exitIp: string
} {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 10)
  
  return {
    finalUrlSuffix: `gclid=auto-${campaignId}-${timestamp}-${index}-${randomId}&utm_source=google&utm_medium=cpc&utm_campaign=${campaignId}`,
    exitIp: `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
  }
}

/**
 * 检查指定 campaign 的库存水位
 */
export async function checkStockLevel(
  userId: string,
  campaignId: string
): Promise<{
  availableCount: number
  needsReplenish: boolean
  deficit: number
  watermark: number  // 新增：返回当前使用的水位
}> {
  const availableCount = await prisma.suffixStockItem.count({
    where: {
      userId,
      campaignId,
      status: 'available',
      deletedAt: null,
    },
  })

  // 动态计算水位（替换固定的 STOCK_CONFIG.LOW_WATERMARK）
  const watermark = await calculateDynamicWatermark(userId, campaignId)

  const needsReplenish = availableCount < watermark
  const deficit = needsReplenish
    ? STOCK_CONFIG.PRODUCE_BATCH_SIZE - availableCount
    : 0

  return {
    availableCount,
    needsReplenish,
    deficit,
    watermark,  // 新增：返回水位值
  }
}

/**
 * 为单个 campaign 补货
 */
export async function replenishCampaign(
  userId: string,
  campaignId: string,
  forceReplenish: boolean = false
): Promise<ReplenishResult> {
  try {
    // 1. 检查当前库存水位
    const { availableCount, needsReplenish, deficit, watermark } = await checkStockLevel(userId, campaignId)

    // 2. 如果不需要补货且非强制，跳过
    if (!needsReplenish && !forceReplenish) {
      return {
        campaignId,
        userId,
        previousCount: availableCount,
        producedCount: 0,
        currentCount: availableCount,
        status: 'skipped',
        message: `库存充足（${availableCount} >= ${watermark}）`,  // 使用动态水位
      }
    }

    // 3. 计算需要生产的数量
    const produceCount = forceReplenish 
      ? STOCK_CONFIG.PRODUCE_BATCH_SIZE 
      : Math.max(deficit, STOCK_CONFIG.PRODUCE_BATCH_SIZE - availableCount)

    // 4. 检查是否有联盟链接配置
    const affiliateLink = await prisma.affiliateLink.findFirst({
      where: {
        userId,
        campaignId,
        enabled: true,
        deletedAt: null,
      },
      orderBy: {
        priority: 'desc',
      },
    })

    // 5. 获取 campaign 国家配置和目标域名
    const campaign = await prisma.campaignMeta.findFirst({
      where: { userId, campaignId, deletedAt: null },
    })
    const country = campaign?.country || 'US'
    
    // 从 finalUrl 中提取目标域名（用于追踪时早停，与验证功能逻辑一致）
    let targetDomain: string | undefined
    if (campaign?.finalUrl) {
      try {
        // finalUrl 可能是完整 URL 或纯域名
        if (campaign.finalUrl.startsWith('http')) {
          targetDomain = new URL(campaign.finalUrl).hostname
        } else {
          // 纯域名，直接使用
          targetDomain = campaign.finalUrl
        }
        console.log(`[Stock] Campaign ${campaignId} target domain: ${targetDomain}`)
      } catch {
        // 解析失败，忽略
        console.log(`[Stock] Campaign ${campaignId} has invalid finalUrl: ${campaign.finalUrl}`)
      }
    }

    // 6. 生成库存项（并发处理）
    // 检查是否有可用的代理供应商（现在需要 userId 参数，返回 Promise）
    const hasProxy = affiliateLink ? await isProxyServiceAvailable(userId) : false
    const useRealGenerator = hasProxy && affiliateLink

    // 创建并发限制器
    const limit = createConcurrencyLimiter(STOCK_CONCURRENCY)
    
    console.log(`[Stock] Starting concurrent generation: ${produceCount} items, concurrency=${STOCK_CONCURRENCY}`)
    const startTime = Date.now()

    // 并发生成所有 suffix
    const generateTasks = Array.from({ length: produceCount }, (_, i) => {
      return limit(async () => {
        let finalUrlSuffix: string
        let exitIp: string

        if (useRealGenerator && affiliateLink) {
          // 使用真实代理生成 suffix（传入目标域名，到达目标域名就早停）
          const result = await generateSuffix({
            userId,
            campaignId,
            affiliateLinkId: affiliateLink.id,
            affiliateUrl: affiliateLink.url,
            country,
            targetDomain,  // 关键：传入目标域名
          })

          if (result.success && result.finalUrlSuffix) {
            finalUrlSuffix = result.finalUrlSuffix
            exitIp = result.exitIp || ''
          } else {
            // 生成失败
            if (!ALLOW_MOCK_SUFFIX) {
              // 生产环境不允许模拟数据，跳过此条
              console.warn(`[Stock] Skipped suffix generation for ${campaignId}: ${result.error || 'generation failed'}`)
              return null  // 返回 null 表示跳过
            }

            // 开发环境允许使用模拟数据
            console.log(`[Stock] Generation failed, using mock data (dev mode): ${result.error}`)
            const mock = generateMockSuffix(campaignId, i + 1)
            finalUrlSuffix = mock.finalUrlSuffix
            exitIp = mock.exitIp
          }
        } else {
          // 无联盟链接或无代理
          if (!ALLOW_MOCK_SUFFIX) {
            // 生产环境不允许模拟数据，跳过此条
            console.warn(`[Stock] Skipped suffix generation for ${campaignId}: no proxy available`)
            return null  // 返回 null 表示跳过
          }

          // 开发环境允许使用模拟数据
          const mock = generateMockSuffix(campaignId, i + 1)
          finalUrlSuffix = mock.finalUrlSuffix
          exitIp = mock.exitIp
        }
        
        return {
          userId,
          campaignId,
          finalUrlSuffix,
          status: 'available' as const,
          exitIp,
          sourceAffiliateLinkId: affiliateLink?.id || null,
        }
      })
    })

    // 等待所有任务完成，过滤掉跳过的项（null）
    const results = await Promise.all(generateTasks)
    const stockItems = results.filter((item): item is NonNullable<typeof item> => item !== null)

    const elapsed = Date.now() - startTime
    const skippedCount = results.length - stockItems.length
    if (skippedCount > 0) {
      console.log(`[Stock] Skipped ${skippedCount} items due to proxy unavailability (production mode)`)
    }
    console.log(`[Stock] Generated ${stockItems.length} items in ${elapsed}ms (${stockItems.length > 0 ? (elapsed / stockItems.length).toFixed(0) : 0}ms/item avg)`)

    // 如果没有成功生成任何项，返回错误
    if (stockItems.length === 0) {
      return {
        campaignId,
        userId,
        previousCount: availableCount,
        producedCount: 0,
        currentCount: availableCount,
        status: 'error',
        message: '无法生成库存：无可用代理且不允许使用模拟数据',
      }
    }

    // 7. 批量创建库存
    const created = await prisma.suffixStockItem.createMany({
      data: stockItems,
    })

    // 8. 记录审计日志
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'stock_replenish',
        resourceType: 'SuffixStockItem',
        resourceId: campaignId,
        metadata: {
          previousCount: availableCount,
          producedCount: created.count,
          forceReplenish,
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

/**
 * 获取符合补货条件的 Campaign 列表
 *
 * 筛选条件：
 * 1. 状态已启用（status: active）
 * 2. 国家不为空（country 有值）
 * 3. 有联盟链接配置（AffiliateLink 存在且启用）
 *
 * 优化：使用单次 SQL 查询（EXISTS 子查询）替代两次查询 + 内存过滤
 */
export async function getEligibleCampaigns(): Promise<Array<{
  userId: string
  campaignId: string
  campaignName: string | null
  country: string | null
  hasAffiliateLink: boolean
}>> {
  // 使用单次 SQL 查询，通过 EXISTS 子查询过滤有联盟链接的 campaign
  const campaigns = await prisma.$queryRaw<Array<{
    userId: string
    campaignId: string
    campaignName: string | null
    country: string | null
  }>>`
    SELECT
      cm.userId,
      cm.campaignId,
      cm.campaignName,
      cm.country
    FROM CampaignMeta cm
    WHERE cm.status = 'active'
      AND cm.deletedAt IS NULL
      AND cm.country IS NOT NULL
      AND cm.country != ''
      AND EXISTS (
        SELECT 1 FROM AffiliateLink al
        WHERE al.userId = cm.userId
          AND al.campaignId = cm.campaignId
          AND al.enabled = 1
          AND al.deletedAt IS NULL
          AND al.url != ''
      )
  `

  return campaigns.map(c => ({
    ...c,
    hasAffiliateLink: true,
  }))
}

/**
 * 批量检查并补货所有低水位 campaign
 * 
 * 用于定时任务（每 5 分钟）兜底扫描
 * 
 * 筛选条件（Campaign 总数）：
 * - 状态已启用（active）
 * - 国家不为空
 * - 联盟链接不为空
 * 
 * @param force 是否强制补货（忽略水位检查）
 */
export async function replenishAllLowStock(force: boolean = false): Promise<BatchReplenishResult> {
  let replenished = 0
  let skipped = 0
  let errors = 0

  try {
    // 1. 获取符合条件的 campaign 列表
    const eligibleCampaigns = await getEligibleCampaigns()
    
    console.log(`[Stock] 找到 ${eligibleCampaigns.length} 个符合条件的 Campaign（状态启用 + 国家不为空 + 联盟链接不为空）${force ? '（强制补货模式）' : ''}`)
    console.log(`[Stock] Campaign 并发数: ${CAMPAIGN_CONCURRENCY}, 单 Campaign 内并发数: ${STOCK_CONCURRENCY}`)

    const startTime = Date.now()

    // 2. 并发处理多个 Campaign（使用并发限制器）
    const campaignLimit = createConcurrencyLimiter(CAMPAIGN_CONCURRENCY)
    
    const replenishTasks = eligibleCampaigns.map(campaign => {
      return campaignLimit(async () => {
        return replenishCampaign(campaign.userId, campaign.campaignId, force)
      })
    })

    const results = await Promise.all(replenishTasks)

    // 统计结果
    for (const result of results) {
      switch (result.status) {
        case 'success':
          replenished++
          break
        case 'skipped':
          skipped++
          break
        case 'error':
          errors++
          break
      }
    }

    const elapsed = Date.now() - startTime
    console.log(`[Stock] 批量补货完成: ${results.length} campaigns, ${elapsed}ms (${(elapsed / 1000).toFixed(1)}s)`)

    return {
      totalCampaigns: eligibleCampaigns.length,
      replenished,
      skipped,
      errors,
      details: results,
    }

  } catch (error) {
    console.error('Batch replenish error:', error)
    return {
      totalCampaigns: 0,
      replenished: 0,
      skipped: 0,
      errors: 1,
      details: [{
        campaignId: 'unknown',
        userId: 'unknown',
        previousCount: 0,
        producedCount: 0,
        currentCount: 0,
        status: 'error',
        message: error instanceof Error ? error.message : '批量补货失败',
      }],
    }
  }
}

/**
 * 并发批量补货所有符合条件的 Campaign（首次补货专用）
 * 
 * 特点：
 * 1. 并发执行，大幅提升补货速度
 * 2. 每个 Campaign 补货 produceBatchSize（默认 10）条不同 IP 的 suffix
 * 3. 控制并发数量，避免资源耗尽
 * 
 * @param concurrency 并发数，默认 5（可根据代理服务能力调整）
 * @param forceReplenish 是否强制补货（忽略水位检查）
 */
export async function replenishAllConcurrently(
  concurrency: number = 5,
  forceReplenish: boolean = true
): Promise<BatchReplenishResult> {
  const results: ReplenishResult[] = []
  let replenished = 0
  let skipped = 0
  let errors = 0

  try {
    // 1. 获取符合条件的 campaign 列表
    const eligibleCampaigns = await getEligibleCampaigns()
    const totalCampaigns = eligibleCampaigns.length
    
    console.log(`\n📦 [并发补货] 开始为 ${totalCampaigns} 个 Campaign 补货...`)
    console.log(`   - 并发数: ${concurrency}`)
    console.log(`   - 每个 Campaign 补货数量: ${STOCK_CONFIG.PRODUCE_BATCH_SIZE}`)
    console.log(`   - 强制补货: ${forceReplenish}`)
    console.log('')

    if (totalCampaigns === 0) {
      console.log('⚠️  没有找到符合条件的 Campaign')
      return {
        totalCampaigns: 0,
        replenished: 0,
        skipped: 0,
        errors: 0,
        details: [],
      }
    }

    const startTime = Date.now()

    // 2. 分批并发执行
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
              forceReplenish
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
      
      // 批次间添加短暂延迟，避免过度消耗资源
      if (i + concurrency < totalCampaigns) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)
    
    console.log(`\n📊 [补货完成] 耗时: ${duration}s`)
    console.log(`   - 总计: ${totalCampaigns} 个 Campaign`)
    console.log(`   - 成功: ${replenished}`)
    console.log(`   - 跳过: ${skipped}`)
    console.log(`   - 失败: ${errors}`)

    return {
      totalCampaigns,
      replenished,
      skipped,
      errors,
      details: results,
    }

  } catch (error) {
    console.error('Concurrent batch replenish error:', error)
    return {
      totalCampaigns: 0,
      replenished: 0,
      skipped: 0,
      errors: 1,
      details: [{
        campaignId: 'unknown',
        userId: 'unknown',
        previousCount: 0,
        producedCount: 0,
        currentCount: 0,
        status: 'error',
        message: error instanceof Error ? error.message : '并发批量补货失败',
      }],
    }
  }
}

/**
 * 异步触发单个 campaign 补货（用于 lease 后）
 * 
 * 非阻塞，不影响主流程
 */
export function triggerReplenishAsync(userId: string, campaignId: string): void {
  // 使用 setImmediate 或 setTimeout 异步执行
  setImmediate(async () => {
    try {
      const result = await replenishCampaign(userId, campaignId)
      if (result.status === 'success') {
        console.log(`[Stock] Async replenish for ${campaignId}: +${result.producedCount}`)
      }
    } catch (error) {
      console.error(`[Stock] Async replenish error for ${campaignId}:`, error)
    }
  })
}

/**
 * 获取库存统计信息
 */
export async function getStockStats(userId?: string): Promise<{
  campaigns: Array<{
    userId: string
    campaignId: string
    available: number
    leased: number
    consumed: number
    total: number
    needsReplenish: boolean
  }>
  summary: {
    totalCampaigns: number
    lowStockCampaigns: number
    totalAvailable: number
    totalLeased: number
    totalConsumed: number
  }
}> {
  // 按 userId + campaignId + status 分组统计
  const stats = await prisma.suffixStockItem.groupBy({
    by: ['userId', 'campaignId', 'status'],
    where: {
      ...(userId ? { userId } : {}),
      deletedAt: null,
    },
    _count: true,
  })

  // 聚合每个 campaign 的统计
  const campaignMap = new Map<string, {
    userId: string
    campaignId: string
    available: number
    leased: number
    consumed: number
  }>()

  for (const stat of stats) {
    const key = `${stat.userId}:${stat.campaignId}`
    if (!campaignMap.has(key)) {
      campaignMap.set(key, {
        userId: stat.userId,
        campaignId: stat.campaignId,
        available: 0,
        leased: 0,
        consumed: 0,
      })
    }
    const entry = campaignMap.get(key)!
    // _count 可能是 number 或 { _all: number } 取决于 Prisma 版本
    const count = typeof stat._count === 'number' ? stat._count : (stat._count as { _all: number })._all
    switch (stat.status) {
      case 'available':
        entry.available = count
        break
      case 'leased':
        entry.leased = count
        break
      case 'consumed':
        entry.consumed = count
        break
    }
  }

  // 转换为数组并计算总计
  //
  // 性能说明：needsReplenish 使用固定水位（STOCK_CONFIG.LOW_WATERMARK）而非动态水位
  // 原因：
  // 1. getStockStats 是 Dashboard 展示用的聚合查询，可能涉及大量 campaign
  // 2. 动态水位需要为每个 campaign 单独查询过去 24h 消费记录（N+1 查询问题）
  // 3. 实际补货逻辑（checkStockLevel/replenishCampaign）已使用动态水位
  // 4. Dashboard 显示的 needsReplenish 仅作为参考指标，不影响实际补货决策
  //
  // 如需精确显示，可考虑：
  // - 定时任务预计算并缓存每个 campaign 的动态水位
  // - 或在 campaign 详情页单独调用 calculateDynamicWatermark
  const campaigns = Array.from(campaignMap.values()).map(c => ({
    ...c,
    total: c.available + c.leased + c.consumed,
    needsReplenish: c.available < STOCK_CONFIG.LOW_WATERMARK,
  }))

  const summary = {
    totalCampaigns: campaigns.length,
    lowStockCampaigns: campaigns.filter(c => c.needsReplenish).length,
    totalAvailable: campaigns.reduce((sum, c) => sum + c.available, 0),
    totalLeased: campaigns.reduce((sum, c) => sum + c.leased, 0),
    totalConsumed: campaigns.reduce((sum, c) => sum + c.consumed, 0),
  }

  return { campaigns, summary }
}

