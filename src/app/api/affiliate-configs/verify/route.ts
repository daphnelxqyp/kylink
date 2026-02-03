/**
 * 验证联盟链接 API
 * 
 * POST /api/affiliate-configs/verify
 * 
 * 功能：验证联盟链接的重定向链路，追踪跳转过程
 * 用途：前端 Timeline 展示、链接有效性检测
 * 
 * 代理选择策略：
 * 1. 按优先级从小到大选择代理（0 = 最高优先级）
 * 2. 24小时内已使用的出口 IP 会被跳过（基于实际出口 IP 去重）
 * 3. 代理连接失败时自动尝试下一个优先级
 * 4. 所有代理都失败时使用直连
 */

import { NextRequest, NextResponse } from 'next/server'
import type {
  AffiliateVerifyRequest,
  AffiliateVerifyResponse,
  RedirectStep,
  TriedProxy,
} from '@/types/affiliate-verify'
import { AFFILIATE_VERIFY_DEFAULTS } from '@/types/affiliate-verify'
import {
  trackRedirects,
  extractDomain,
  type TrackRedirectsResult,
} from '@/lib/redirect/tracker'
import {
  extractRootDomain,
  validateDomain,
} from '@/lib/redirect/domain-validator'
import {
  getAvailableProxies,
  getNextProxyConfig,
  getProxyExitIp,
  recordProxyUsage,
  type ProxyConfig,
  type ProxySelectionContext,
  type ExitIpInfo,
} from '@/lib/proxy-selector'

// ============================================
// Next.js App Router 配置
// ============================================

/** 使用 Node.js 运行时 */
export const runtime = 'nodejs'

/** 禁用静态缓存，每次请求都动态执行 */
export const dynamic = 'force-dynamic'

// ============================================
// 类型定义（复用 proxy-selector 模块）
// ============================================

// ============================================
// 工具函数（使用 proxy-selector 模块）
// ============================================

// ============================================
// 代理配置（使用 proxy-selector 模块）
// ============================================

/**
 * 判断错误是否为代理连接错误
 */
function isProxyConnectionError(error: string | undefined): boolean {
  if (!error) return false
  
  const proxyErrorPatterns = [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'PROXY_ERROR',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'socket hang up',
    'connect ECONNREFUSED',
    'tunneling socket',
    'Proxy connection',
    'proxy error',
    'Socket closed',
  ]
  
  return proxyErrorPatterns.some(pattern => 
    error.toLowerCase().includes(pattern.toLowerCase())
  )
}

// recordProxyUsage 使用 proxy-selector 模块的实现

// ============================================
// 核心验证逻辑（支持代理失败自动切换）
// ============================================

interface VerifyWithFallbackResult {
  trackResult: TrackRedirectsResult
  usedProxy?: ProxyConfig
  exitIpInfo?: ExitIpInfo  // 实际出口 IP 信息
  triedProxies: TriedProxy[]
}

/**
 * 使用代理进行验证，失败时自动切换到下一个代理
 */
async function verifyWithProxyFallback(
  request: AffiliateVerifyRequest & { userId?: string },
  context: ProxySelectionContext | null
): Promise<VerifyWithFallbackResult> {
  const triedProxies: TriedProxy[] = []
  let lastError: string | undefined
  
  // 如果有代理上下文，尝试使用代理
  if (context) {
    let proxyConfig: ProxyConfig | null
    
    while ((proxyConfig = getNextProxyConfig(context)) !== null) {
      const { provider, proxy, username } = proxyConfig
      
      try {
        console.log(`[affiliate-verify] Attempting with proxy: ${provider.name}`)

        // 先获取代理的实际出口 IP 和国家信息（使用已解密的密码）
        const exitIpInfo = await getProxyExitIp(proxy, username, proxy.password || '')
        
        if (!exitIpInfo) {
          console.log(`[affiliate-verify] Failed to get exit IP for ${provider.name}`)
          triedProxies.push({
            providerName: provider.name,
            host: provider.host,
            priority: provider.priority,
            success: false,
            failReason: '无法获取出口 IP',
          })
          continue
        }
        
        // 检查出口 IP 是否在24小时内已使用
        if (context.usedIpSet.has(exitIpInfo.ip)) {
          console.log(`[affiliate-verify] Exit IP ${exitIpInfo.ip} already used in 24h, trying next proxy...`)
          triedProxies.push({
            providerName: provider.name,
            host: `${exitIpInfo.ip}${exitIpInfo.country ? ` (${exitIpInfo.country})` : ''}`,
            priority: provider.priority,
            success: false,
            failReason: `出口 IP ${exitIpInfo.ip} 24h内已使用`,
          })
          continue
        }
        
        // 执行追踪
        const trackResult = await trackRedirects({
          url: request.affiliateLink,
          maxRedirects: request.maxRedirects,
          targetDomain: request.targetDomain,
          proxy,
          initialReferer: request.referrer,
          requestTimeout: AFFILIATE_VERIFY_DEFAULTS.requestTimeout,
          totalTimeout: AFFILIATE_VERIFY_DEFAULTS.totalTimeout,
          retryCount: 1, // 代理模式下减少重试次数，快速切换
        })
        
        // 检查是否为代理连接错误
        if (!trackResult.success && isProxyConnectionError(trackResult.errorMessage)) {
          console.log(`[affiliate-verify] Proxy ${provider.name} connection failed: ${trackResult.errorMessage}`)
          triedProxies.push({
            providerName: provider.name,
            host: `${exitIpInfo.ip}${exitIpInfo.country ? ` (${exitIpInfo.country})` : ''}`,
            priority: provider.priority,
            success: false,
            failReason: trackResult.errorMessage || '连接失败',
          })
          lastError = trackResult.errorMessage
          continue // 尝试下一个代理
        }
        
        // 追踪成功或非代理错误，返回结果
        triedProxies.push({
          providerName: provider.name,
          host: `${exitIpInfo.ip}${exitIpInfo.country ? ` (${exitIpInfo.country})` : ''}`,
          priority: provider.priority,
          success: true,
        })
        
        // 合并之前跳过的代理记录
        return {
          trackResult,
          usedProxy: proxyConfig,
          exitIpInfo,
          triedProxies: [...context.triedProxies, ...triedProxies],
        }
        
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error(`[affiliate-verify] Proxy ${provider.name} error:`, errorMessage)
        
        triedProxies.push({
          providerName: provider.name,
          host: provider.host,
          priority: provider.priority,
          success: false,
          failReason: errorMessage,
        })
        lastError = errorMessage
        // 继续尝试下一个代理
      }
    }
    
    console.log(`[affiliate-verify] All proxies exhausted, falling back to direct connection`)
  }
  
  // 所有代理都失败，使用直连
  console.log(`[affiliate-verify] Using direct connection`)
  
  const trackResult = await trackRedirects({
    url: request.affiliateLink,
    maxRedirects: request.maxRedirects,
    targetDomain: request.targetDomain,
    proxy: undefined, // 直连
    initialReferer: request.referrer,
    requestTimeout: AFFILIATE_VERIFY_DEFAULTS.requestTimeout,
    totalTimeout: AFFILIATE_VERIFY_DEFAULTS.totalTimeout,
    retryCount: 2,
  })
  
  // 如果有代理上下文，添加直连记录
  const allTriedProxies = context 
    ? [...context.triedProxies, ...triedProxies]
    : triedProxies
  
  // 如果所有代理都失败了，添加最后的错误信息
  if (allTriedProxies.length > 0 && !trackResult.success && lastError) {
    // 如果直连也失败，且之前有代理错误，补充说明
    if (trackResult.errorMessage) {
      trackResult.errorMessage = `代理均失败后直连: ${trackResult.errorMessage}`
    }
  }
  
  return {
    trackResult,
    usedProxy: undefined,
    exitIpInfo: undefined,
    triedProxies: allTriedProxies,
  }
}

// ============================================
// 请求参数校验
// ============================================

interface ValidationResult {
  valid: boolean
  error?: string
  data?: AffiliateVerifyRequest & { userId?: string }
}

/**
 * 校验请求参数
 */
function validateRequest(body: unknown): ValidationResult {
  // 基本类型检查
  if (!body || typeof body !== 'object') {
    return { valid: false, error: '请求体必须是 JSON 对象' }
  }

  const data = body as Record<string, unknown>

  // 必填字段检查：affiliateLink
  if (!data.affiliateLink || typeof data.affiliateLink !== 'string') {
    return { valid: false, error: 'affiliateLink 是必填字段，且必须是字符串' }
  }

  // 必填字段检查：countryCode
  if (!data.countryCode || typeof data.countryCode !== 'string') {
    return { valid: false, error: 'countryCode 是必填字段，且必须是字符串' }
  }

  // URL 格式校验
  try {
    new URL(data.affiliateLink)
  } catch {
    return { valid: false, error: 'affiliateLink 必须是有效的 URL 格式' }
  }

  // 国家代码格式校验（2-3 位字母）
  if (!/^[A-Z]{2,3}$/i.test(data.countryCode)) {
    return { valid: false, error: 'countryCode 必须是 2-3 位字母的国家代码' }
  }

  // 可选字段校验
  if (data.targetDomain !== undefined && typeof data.targetDomain !== 'string') {
    return { valid: false, error: 'targetDomain 必须是字符串' }
  }

  if (data.referrer !== undefined && typeof data.referrer !== 'string') {
    return { valid: false, error: 'referrer 必须是字符串' }
  }

  if (data.campaignId !== undefined && typeof data.campaignId !== 'string') {
    return { valid: false, error: 'campaignId 必须是字符串' }
  }

  if (data.userId !== undefined && typeof data.userId !== 'string') {
    return { valid: false, error: 'userId 必须是字符串' }
  }

  if (data.maxRedirects !== undefined) {
    if (typeof data.maxRedirects !== 'number' || data.maxRedirects < 1 || data.maxRedirects > 30) {
      return { valid: false, error: 'maxRedirects 必须是 1-30 之间的数字' }
    }
  }

  // 构建标准化的请求对象
  const request: AffiliateVerifyRequest & { userId?: string } = {
    affiliateLink: data.affiliateLink,
    countryCode: data.countryCode.toUpperCase(),
    targetDomain: data.targetDomain as string | undefined,
    referrer: (data.referrer as string) ?? AFFILIATE_VERIFY_DEFAULTS.referrer,
    campaignId: data.campaignId as string | undefined,
    maxRedirects: (data.maxRedirects as number) ?? AFFILIATE_VERIFY_DEFAULTS.maxRedirects,
    userId: data.userId as string | undefined,
  }

  return { valid: true, data: request }
}

// ============================================
// API Handler
// ============================================

/**
 * POST /api/affiliate-configs/verify
 * 验证联盟链接
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now()

  try {
    // ========================================
    // 1) 读取并解析请求体
    // ========================================
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json<AffiliateVerifyResponse>(
        {
          success: false,
          redirectChain: [],
          matched: false,
          totalRedirects: 0,
          error: '无效的 JSON 格式',
        },
        { status: 400 }
      )
    }

    // ========================================
    // 2) 校验必填参数
    // ========================================
    const validation = validateRequest(body)
    if (!validation.valid || !validation.data) {
      return NextResponse.json<AffiliateVerifyResponse>(
        {
          success: false,
          redirectChain: [],
          matched: false,
          totalRedirects: 0,
          error: validation.error,
        },
        { status: 400 }
      )
    }

    const request = validation.data

    // ========================================
    // 3) 获取代理列表上下文
    // ========================================
    const proxyContext = request.userId
      ? await getAvailableProxies(request.userId, request.countryCode, request.campaignId)
      : null

    // ========================================
    // 4) 执行验证（支持代理失败自动切换）
    // ========================================
    const { trackResult, usedProxy, exitIpInfo, triedProxies } = await verifyWithProxyFallback(
      request,
      proxyContext
    )

    // ========================================
    // 5) 如果追踪成功且使用了代理，记录出口 IP 使用
    // ========================================
    if (trackResult.success && exitIpInfo && request.userId && request.campaignId) {
      await recordProxyUsage(request.userId, request.campaignId, exitIpInfo.ip)
    }

    // ========================================
    // 6) 组装返回给前端的响应
    // ========================================

    // 映射 redirectSteps 到前端需要的 redirectChain 格式
    const redirectChain: RedirectStep[] = trackResult.redirectSteps.map((step: RedirectStep) => ({
      step: step.step,
      url: step.url,
      domain: step.domain || extractDomain(step.url),
      statusCode: step.statusCode,
      redirectType: step.redirectType,
    }))

    // 提取最终域名
    const finalDomain = extractRootDomain(trackResult.finalUrl) ?? extractDomain(trackResult.finalUrl)

    // 判断域名是否匹配
    let matched = false
    if (request.targetDomain) {
      // 优先使用 trackResult.domainValidation
      if (trackResult.domainValidation) {
        matched = trackResult.domainValidation.isValid
      } else {
        // 否则使用 validateDomain 函数
        const domainValidation = validateDomain(trackResult.finalUrl, request.targetDomain)
        matched = domainValidation.isValid
      }
    }

    // 构建代理信息字符串 - 显示实际出口 IP 和国家
    let proxyInfo: string | undefined
    if (exitIpInfo) {
      // 格式：IP (国家) 例如：184.152.164.140 (US)
      proxyInfo = exitIpInfo.country 
        ? `${exitIpInfo.ip} (${exitIpInfo.country})`
        : exitIpInfo.ip
    }

    // 构建响应
    const response: AffiliateVerifyResponse = {
      success: trackResult.success,
      redirectChain,
      finalUrl: trackResult.finalUrl,
      finalDomain,
      matched,
      totalRedirects: trackResult.redirectCount,
      duration: Date.now() - startTime,
      proxyIp: proxyInfo,
      error: trackResult.errorMessage,
      triedProxies: triedProxies.length > 0 ? triedProxies : undefined,
    }

    return NextResponse.json<AffiliateVerifyResponse>(response, { status: 200 })

  } catch (error) {
    // ========================================
    // 7) 异常处理：不泄露堆栈
    // ========================================
    console.error('[affiliate-verify] Unexpected error:', error)
    
    // 构建安全的错误响应（不暴露堆栈信息）
    const safeErrorMessage = error instanceof Error 
      ? `服务器内部错误: ${error.message}`
      : '服务器内部错误'

    return NextResponse.json<AffiliateVerifyResponse>(
      {
        success: false,
        redirectChain: [],
        matched: false,
        totalRedirects: 0,
        duration: Date.now() - startTime,
        error: safeErrorMessage,
      },
      { status: 500 }
    )
  }
}

// ============================================
// 示例请求/响应
// ============================================

/**
 * 示例请求：
 * 
 * POST /api/affiliate-configs/verify
 * Content-Type: application/json
 * 
 * {
 *   "affiliateLink": "https://click.example.com/aff?id=123",
 *   "countryCode": "US",
 *   "targetDomain": "amazon.com",
 *   "referrer": "https://t.co/abc123",
 *   "maxRedirects": 10,
 *   "campaignId": "camp_001",
 *   "userId": "user-uuid-xxx"
 * }
 * 
 * 
 * 示例响应（成功，使用代理，显示实际出口 IP 和国家）：
 * 
 * {
 *   "success": true,
 *   "redirectChain": [
 *     {
 *       "step": 1,
 *       "url": "https://click.example.com/aff?id=123",
 *       "domain": "click.example.com",
 *       "statusCode": 302,
 *       "redirectType": "http"
 *     },
 *     {
 *       "step": 2,
 *       "url": "https://www.amazon.com/dp/B08N5WRWNW?tag=aff-20",
 *       "domain": "www.amazon.com",
 *       "statusCode": 200
 *     }
 *   ],
 *   "finalUrl": "https://www.amazon.com/dp/B08N5WRWNW?tag=aff-20",
 *   "finalDomain": "amazon.com",
 *   "matched": true,
 *   "totalRedirects": 1,
 *   "duration": 2345,
 *   "proxyIp": "50.32.6.24 (US)",
 *   "triedProxies": [
 *     {
 *       "providerName": "abc_test",
 *       "host": "50.32.6.24 (US)",
 *       "priority": 0,
 *       "success": true
 *     }
 *   ]
 * }
 */
