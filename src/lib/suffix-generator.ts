/**
 * Suffix 生成器模块
 * 
 * 职责：
 * 1. 通过代理访问联盟链接
 * 2. 追踪重定向链路获取最终 URL
 * 3. 从最终 URL 提取参数构建 finalUrlSuffix
 * 4. 管理代理 IP 去重
 * 
 * 生成流程：
 * 1. 获取 campaign 的联盟链接配置
 * 2. 选择合适的代理出口（按优先级，24小时 IP 去重）
 * 3. 通过代理追踪联盟链接的重定向链路
 * 4. 从最终 URL 解析追踪参数
 * 5. 构建 finalUrlSuffix
 */

import prisma from './prisma'
import {
  getAvailableProxies,
  selectAvailableProxy,
  recordProxyUsage,
  type ExitIpInfo,
  type TriedProxy,
} from './proxy-selector'
import { trackRedirects, extractDomain, type TrackRedirectsResult } from './redirect/tracker'

// ============================================
// 环境变量配置
// ============================================

/**
 * 是否允许在无代理时使用模拟数据
 * 生产环境应设置为 false，开发环境可设置为 true
 */
const ALLOW_MOCK_SUFFIX = process.env.ALLOW_MOCK_SUFFIX === 'true'

// ============================================
// 类型定义
// ============================================

/**
 * Suffix 生成请求参数
 */
export interface SuffixGenerateRequest {
  userId: string
  campaignId: string
  affiliateLinkId: string
  affiliateUrl: string
  country: string
  /** 目标域名（用于早停判断，与验证功能逻辑一致） */
  targetDomain?: string
}

/**
 * Suffix 生成结果
 */
export interface SuffixGenerateResult {
  success: boolean
  finalUrlSuffix?: string
  exitIp?: string
  trackedUrl?: string
  redirectCount?: number
  triedProxies?: TriedProxy[]
  error?: string
}

/**
 * 批量生成结果
 */
export interface BatchGenerateResult {
  generated: number
  failed: number
  results: SuffixGenerateResult[]
}

// ============================================
// 代理服务检查
// ============================================

/**
 * 检查用户是否有可用的代理供应商
 * 
 * @param userId 用户 ID
 * @returns 是否有可用代理
 */
export async function isProxyServiceAvailable(userId?: string): Promise<boolean> {
  if (!userId) {
    // 无 userId 时检查是否有任何启用的代理供应商
    const count = await prisma.proxyProvider.count({
      where: {
        enabled: true,
        deletedAt: null,
      },
    })
    return count > 0
  }

  // 检查用户是否分配了代理供应商
  const count = await prisma.proxyProvider.count({
    where: {
      enabled: true,
      deletedAt: null,
      assignedUsers: {
        some: {
          userId: userId,
        },
      },
    },
  })

  return count > 0
}

// ============================================
// URL 验证
// ============================================

/**
 * 验证 URL 是否有效
 * 只允许 http 和 https 协议
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

// ============================================
// 核心函数
// ============================================

/**
 * 从 URL 中提取查询参数
 */
function extractQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {}
  
  try {
    const urlObj = new URL(url)
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value
    })
  } catch {
    // URL 解析失败，返回空对象
  }
  
  return params
}

/**
 * 构建 finalUrlSuffix
 * 
 * 策略（与验证功能一致）：
 * 直接取最终 URL 的 '?' 后面的部分作为 suffix
 * 
 * 示例：
 * - 最终 URL: https://www.smartwool.com/shop/sale?tag=aff-123&ref=kyads
 * - 输出 suffix: tag=aff-123&ref=kyads
 */
function buildFinalUrlSuffix(
  trackResult: TrackRedirectsResult,
  exitIpInfo?: ExitIpInfo
): string {
  const finalUrl = trackResult.finalUrl
  
  // 1. 按 '?' 拆分 URL，取第 2 段作为 suffix
  const questionIndex = finalUrl.indexOf('?')
  let suffix = ''
  
  if (questionIndex !== -1) {
    // 有查询参数，直接取 '?' 后面的部分
    suffix = finalUrl.substring(questionIndex + 1)
    
    // 移除可能的 hash 部分（#xxx）
    const hashIndex = suffix.indexOf('#')
    if (hashIndex !== -1) {
      suffix = suffix.substring(0, hashIndex)
    }
  }
  
  // 2. 如果没有查询参数，使用提取的参数构建
  if (!suffix) {
    const params: Record<string, string> = {}
    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 10)
    
    // 生成一个 gclid
    params['gclid'] = `ky_${timestamp}_${randomId}`
    
    // 添加代理出口信息（用于调试和追踪）
    if (exitIpInfo) {
      params['ky_proxy_ip'] = exitIpInfo.ip
      if (exitIpInfo.country) {
        params['ky_proxy_country'] = exitIpInfo.country
      }
    }
    
    // 添加生成时间戳
    params['ky_ts'] = String(timestamp)
    
    // 构建查询字符串
    const parts: string[] = []
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      }
    }
    suffix = parts.join('&')
  }
  
  console.log(`[suffix-generator] Built suffix from URL: ${finalUrl.substring(0, 60)}... → ${suffix.substring(0, 80)}${suffix.length > 80 ? '...' : ''}`)
  
  return suffix
}

/**
 * 生成模拟的 finalUrlSuffix（无代理可用时的降级方案）
 */
function generateMockSuffix(campaignId: string, index: number = 1): {
  finalUrlSuffix: string
  exitIp: string
} {
  const timestamp = Date.now()
  const randomId = Math.random().toString(36).substring(2, 10)
  
  return {
    finalUrlSuffix: `gclid=mock_${campaignId}_${timestamp}_${index}_${randomId}&utm_source=google&utm_medium=cpc&utm_campaign=${campaignId}&ky_ts=${timestamp}&ky_mode=mock`,
    exitIp: `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
  }
}

/**
 * 生成 Suffix（核心函数）
 * 
 * 完整流程：
 * 1. 获取用户可用的代理供应商
 * 2. 按优先级选择代理（24小时 IP 去重）
 * 3. 通过代理追踪联盟链接重定向
 * 4. 如果追踪失败，自动切换到下一个代理重试（Fallback 机制）
 * 5. 从最终 URL 提取参数构建 suffix
 * 6. 记录代理使用
 */
export async function generateSuffix(
  request: SuffixGenerateRequest
): Promise<SuffixGenerateResult> {
  const { userId, campaignId, affiliateUrl, country, targetDomain } = request

  console.log(`[suffix-generator] Generating suffix for campaign ${campaignId}, country ${country}, targetDomain: ${targetDomain || 'N/A'}`)

  // 验证联盟链接 URL
  if (!isValidUrl(affiliateUrl)) {
    console.error(`[suffix-generator] Invalid affiliate URL for campaign ${campaignId}: ${affiliateUrl}`)
    return {
      success: false,
      error: 'INVALID_URL: 联盟链接 URL 无效或协议不支持（仅支持 http/https）',
    }
  }

  try {
    // 1. 获取用户可用的代理供应商
    const proxyContext = await getAvailableProxies(userId, country, campaignId)
    
    if (!proxyContext) {
      // 无可用代理
      if (!ALLOW_MOCK_SUFFIX) {
        console.error('[suffix-generator] No proxy available and mock suffix is disabled')
        return {
          success: false,
          error: 'NO_PROXY_AVAILABLE: 无可用代理供应商，请联系管理员配置代理',
        }
      }

      // 开发环境允许使用模拟数据
      console.log('[suffix-generator] No proxy available, using mock data (dev mode)')
      const mock = generateMockSuffix(campaignId)
      return {
        success: true,
        finalUrlSuffix: mock.finalUrlSuffix,
        exitIp: mock.exitIp,
        error: 'MOCK_MODE: 未配置代理供应商',
      }
    }
    
    // 收集所有尝试过的代理
    const allTriedProxies: TriedProxy[] = []
    
    // 2. 循环尝试所有可用代理（Fallback 机制）
    while (true) {
      // 选择下一个可用的代理（带 IP 去重）
    const proxySelection = await selectAvailableProxy(proxyContext)
      
      // 合并已尝试的代理记录
      allTriedProxies.push(...proxySelection.triedProxies)
    
    if (!proxySelection.success || !proxySelection.proxyConfig || !proxySelection.exitIpInfo) {
      // 所有代理都不可用
      if (!ALLOW_MOCK_SUFFIX) {
        console.error('[suffix-generator] All proxies exhausted and mock suffix is disabled')
        return {
          success: false,
          error: 'NO_PROXY_AVAILABLE: 所有代理均不可用，请联系管理员',
          triedProxies: allTriedProxies,
        }
      }

      // 开发环境允许使用模拟数据
        console.log('[suffix-generator] All proxies exhausted, using mock data (dev mode)')
      const mock = generateMockSuffix(campaignId)
      return {
        success: true,
        finalUrlSuffix: mock.finalUrlSuffix,
        exitIp: mock.exitIp,
          triedProxies: allTriedProxies,
        error: 'FALLBACK_MOCK: 所有代理均失败',
      }
    }
    
    const { proxyConfig, exitIpInfo } = proxySelection
    
    // 3. 通过代理追踪联盟链接（带目标域名早停，与验证功能逻辑一致）
    console.log(`[suffix-generator] Tracking affiliate link with proxy ${proxyConfig.provider.name}`)
    
    const trackResult = await trackRedirects({
      url: affiliateUrl,
      proxy: proxyConfig.proxy,
      targetDomain: targetDomain,  // 关键：传入目标域名，到达目标域名就早停
      initialReferer: 'https://t.co',
      maxRedirects: 15,
      requestTimeout: 25000,  // 提高到25秒，匹配验证功能的超时需求
      totalTimeout: 90000,    // 总超时提高到90秒
      retryCount: 1,          // 减少重试次数，快速切换代理
    })
    
    if (!trackResult.success) {
        // 追踪失败，记录失败原因并尝试下一个代理
        console.log(`[suffix-generator] Tracking failed with proxy ${proxyConfig.provider.name}: ${trackResult.errorMessage}`)
        
        // 更新尝试记录，标记追踪失败
        const lastTried = allTriedProxies[allTriedProxies.length - 1]
        if (lastTried && lastTried.providerName === proxyConfig.provider.name) {
          lastTried.success = false
          lastTried.failReason = `追踪失败: ${trackResult.errorMessage}`
        }
        
        // 检查是否还有更多代理可用
        if (proxyContext.currentIndex >= proxyContext.providers.length) {
          // 已经没有更多代理了
          if (!ALLOW_MOCK_SUFFIX) {
            console.error('[suffix-generator] No more proxies to try and mock suffix is disabled')
            return {
              success: false,
              error: `NO_PROXY_AVAILABLE: 所有代理追踪均失败，最后错误: ${trackResult.errorMessage}`,
              triedProxies: allTriedProxies,
            }
          }

          // 开发环境允许使用模拟数据
          console.log('[suffix-generator] No more proxies to try, using mock data (dev mode)')
          const mock = generateMockSuffix(campaignId)
      return {
            success: true,
            finalUrlSuffix: mock.finalUrlSuffix,
            exitIp: mock.exitIp,
            triedProxies: allTriedProxies,
            error: `FALLBACK_MOCK: 所有代理追踪均失败，最后错误: ${trackResult.errorMessage}`,
      }
        }
        
        console.log(`[suffix-generator] Trying next proxy (${proxyContext.providers.length - proxyContext.currentIndex} remaining)...`)
        // 继续循环，尝试下一个代理
        continue
    }
    
      // 4. 追踪成功，构建 finalUrlSuffix
    const finalUrlSuffix = buildFinalUrlSuffix(trackResult, exitIpInfo)
    
    // 5. 记录代理使用（24小时去重）
    await recordProxyUsage(userId, campaignId, exitIpInfo.ip)
    
      console.log(`[suffix-generator] Successfully generated suffix with proxy ${proxyConfig.provider.name}, final URL: ${trackResult.finalUrl}`)
    
    return {
      success: true,
      finalUrlSuffix,
      exitIp: exitIpInfo.ip,
      trackedUrl: trackResult.finalUrl,
      redirectCount: trackResult.redirectCount,
        triedProxies: allTriedProxies,
      }
    }
    
  } catch (error) {
    console.error('[suffix-generator] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * 批量生成 Suffix
 */
export async function generateSuffixBatch(
  userId: string,
  campaignId: string,
  count: number
): Promise<BatchGenerateResult> {
  // 获取联盟链接配置
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

  if (!affiliateLink) {
    return {
      generated: 0,
      failed: count,
      results: [{
        success: false,
        error: 'NO_AFFILIATE_LINK: 未配置联盟链接',
      }],
    }
  }

  // 获取 campaign 的国家配置
  const campaign = await prisma.campaignMeta.findFirst({
    where: {
      userId,
      campaignId,
      deletedAt: null,
    },
  })

  const country = campaign?.country || 'US'

  // 批量生成
  const results: SuffixGenerateResult[] = []
  let generated = 0
  let failed = 0

  for (let i = 0; i < count; i++) {
    const result = await generateSuffix({
      userId,
      campaignId,
      affiliateLinkId: affiliateLink.id,
      affiliateUrl: affiliateLink.url,
      country,
    })

    results.push(result)
    
    if (result.success) {
      generated++
    } else {
      failed++
    }

    // 添加延迟，避免请求过快
    if (i < count - 1) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  return { generated, failed, results }
}

// ============================================
// 导出兼容旧接口
// ============================================

/**
 * 清理过期的代理 IP 使用记录
 * @deprecated 使用 proxy-selector 模块的 cleanupExpiredProxyUsage
 */
export { cleanupExpiredProxyUsage } from './proxy-selector'

