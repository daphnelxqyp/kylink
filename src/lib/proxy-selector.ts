/**
 * 代理供应商选择模块
 * 
 * 职责：
 * 1. 从数据库获取用户可用的代理供应商
 * 2. 按优先级选择代理
 * 3. 获取代理实际出口 IP
 * 4. 记录出口 IP 使用（24小时去重）
 * 
 * 复用于：
 * - 联盟链接验证 (affiliate-configs/verify)
 * - Suffix 生成 (suffix-generator)
 */

import { SocksProxyAgent } from 'socks-proxy-agent'
import prisma from './prisma'
import type { ProxyProvider } from '@prisma/client'
import type { SingleRequestProxy } from './redirect/tracker'

// 使用 Next.js 内置的 node-fetch
/* eslint-disable */
const fetch = require('next/dist/compiled/node-fetch')
/* eslint-enable */

// ============================================
// 类型定义
// ============================================

/**
 * 代理配置（包含供应商信息和构建好的代理配置）
 */
export interface ProxyConfig {
  provider: ProxyProvider
  proxy: SingleRequestProxy
  username: string
}

/**
 * 出口 IP 信息
 */
export interface ExitIpInfo {
  ip: string
  country?: string
  countryCode?: string
}

/**
 * 代理尝试记录
 */
export interface TriedProxy {
  providerName: string
  host: string
  priority: number
  success: boolean
  exitIp?: string
  failReason?: string
}

/**
 * 代理选择上下文
 */
export interface ProxySelectionContext {
  userId: string
  countryCode: string
  campaignId?: string
  usedIpSet: Set<string>
  providers: ProxyProvider[]
  currentIndex: number
  triedProxies: TriedProxy[]
}

/**
 * 代理选择结果
 */
export interface ProxySelectionResult {
  success: boolean
  proxyConfig?: ProxyConfig
  exitIpInfo?: ExitIpInfo
  triedProxies: TriedProxy[]
  error?: string
}

// ============================================
// IP 检测服务
// ============================================

/**
 * IP 检测服务列表
 * 注：已移除 ipinfo.ipidea.io（DNS 无法解析，导致超时浪费时间）
 */
const IP_CHECK_SERVICES = [
  {
    name: 'httpbin.org',
    url: 'http://httpbin.org/ip',
    parseResponse: (data: Record<string, unknown>): ExitIpInfo | null => {
      if (data.origin) {
        const ip = String(data.origin).split(',')[0]?.trim()
        return ip ? { ip } : null
      }
      return null
    },
  },
  {
    name: 'ipinfo.io',
    url: 'https://ipinfo.io/json',
    parseResponse: (data: Record<string, unknown>): ExitIpInfo | null => {
      if (data.ip) {
        return {
          ip: String(data.ip),
          country: data.country ? String(data.country) : undefined,
          countryCode: data.country ? String(data.country) : undefined,
        }
      }
      return null
    },
  },
  {
    name: 'ipleak.net',
    url: 'https://ipleak.net/json/',
    parseResponse: (data: Record<string, unknown>): ExitIpInfo | null => {
      if (data.ip) {
        return {
          ip: String(data.ip),
          country: data.country_code ? String(data.country_code) : undefined,
          countryCode: data.country_code ? String(data.country_code) : undefined,
        }
      }
      return null
    },
  },
]

// ============================================
// 工具函数
// ============================================

/**
 * 生成随机字符串（字母+数字）
 */
function generateRandom(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * 生成随机数字字符串
 */
function generateRandomDigits(length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString()
  }
  return result
}

/**
 * 处理用户名模板
 * 支持变量：
 * - {COUNTRY}: 国家代码（大写，如 US、UK）
 * - {country}: 国家代码（小写，如 us、uk）
 * - {random:N}: N位随机字符串（字母+数字）
 * - {session:N}: N位随机数字（纯数字，用于会话标识）
 * 
 * 注意：先处理大写变量 {COUNTRY}，再处理小写变量 {country}
 * 避免不区分大小写匹配导致的替换顺序问题
 */
export function processUsernameTemplate(template: string, countryCode: string): string {
  if (!template) return ''
  
  return template
    // 先精确匹配大写 {COUNTRY}，替换为大写国家代码
    .replace(/\{COUNTRY\}/g, countryCode.toUpperCase())
    // 再精确匹配小写 {country}，替换为小写国家代码
    .replace(/\{country\}/g, countryCode.toLowerCase())
    .replace(/\{random:(\d+)\}/gi, (_, len) => generateRandom(parseInt(len)))
    .replace(/\{session:(\d+)\}/gi, (_, len) => generateRandomDigits(parseInt(len)))
}

/** IP 检测超时时间（毫秒） */
const IP_CHECK_TIMEOUT = 8000

/** 连接测试超时时间（毫秒） */
const CONNECTIVITY_TEST_TIMEOUT = 10000

/** 连接测试 URL（使用可靠的简单端点） */
const CONNECTIVITY_TEST_URLS = [
  'http://www.google.com/robots.txt',
  'http://www.baidu.com/robots.txt',
  'http://httpbin.org/status/200',
]

/**
 * 获取代理的实际出口 IP
 * 并行检测多个 IP 服务，返回第一个成功的结果
 */
export async function getProxyExitIp(
  proxy: SingleRequestProxy,
  username: string,
  password: string
): Promise<ExitIpInfo | null> {
  // 构建 SOCKS5 代理 URL
  const proxyUrl = proxy.url.replace(/^socks5?:\/\//, '')
  // 对用户名/密码进行 URL 编码，避免特殊字符导致认证失败
  const encodedUsername = username ? encodeURIComponent(username) : ''
  const encodedPassword = password ? encodeURIComponent(password) : ''
  const authPart = encodedUsername || encodedPassword
    ? `${encodedUsername}:${encodedPassword}@`
    : ''
  const fullProxyUrl = `socks5://${authPart}${proxyUrl}`

  console.log(`[proxy-selector] Testing proxy with username: ${username}`)

  // 并行检测所有 IP 服务，返回第一个成功的结果
  return new Promise((resolve) => {
    let resolved = false
    let failedCount = 0
    const totalServices = IP_CHECK_SERVICES.length

    IP_CHECK_SERVICES.forEach(async (service) => {
      const agent = new SocksProxyAgent(fullProxyUrl, { timeout: IP_CHECK_TIMEOUT })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), IP_CHECK_TIMEOUT)

      try {
        const response = await fetch(service.url, {
          agent: agent as unknown as import('http').Agent,
          signal: controller.signal as unknown as AbortSignal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
        })

        clearTimeout(timeout)

        if (!resolved && response.ok) {
          const data = await response.json() as Record<string, unknown>
          const result = service.parseResponse(data)

          if (result && !resolved) {
            resolved = true
            console.log(`[proxy-selector] Got exit IP from ${service.name}: ${result.ip}${result.country ? ` (${result.country})` : ''}`)
            resolve(result)
          } else if (!resolved) {
            failedCount++
            console.log(`[proxy-selector] ${service.name} failed: Failed to parse response`)
            if (failedCount === totalServices) {
              console.error('[proxy-selector] All IP check services failed')
              resolve(null)
            }
          }
        } else if (!resolved) {
          failedCount++
          console.log(`[proxy-selector] ${service.name} failed: HTTP ${response.status}`)
          if (failedCount === totalServices) {
            console.error('[proxy-selector] All IP check services failed')
            resolve(null)
          }
        }
      } catch (err) {
        clearTimeout(timeout)
        if (!resolved) {
          failedCount++
          const errMsg = err instanceof Error ? err.message : String(err)
          // 判断错误类型，提供更有用的诊断信息
          let diagnosis = ''
          if (errMsg.includes('ECONNREFUSED')) {
            diagnosis = ' (代理连接被拒绝，检查代理服务是否运行)'
          } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('timeout') || errMsg.includes('aborted')) {
            diagnosis = ' (连接超时，检查网络或代理响应)'
          } else if (errMsg.includes('ENOTFOUND')) {
            diagnosis = ' (DNS解析失败，检查代理地址)'
          } else if (errMsg.includes('authentication') || errMsg.includes('auth')) {
            diagnosis = ' (认证失败，检查用户名密码)'
          } else if (errMsg.includes('SOCKS')) {
            diagnosis = ' (SOCKS协议错误，可能是认证失败或代理不支持)'
          } else if (errMsg.includes('ECONNRESET')) {
            diagnosis = ' (连接被重置，代理可能拒绝请求)'
          }
          console.log(`[proxy-selector] ${service.name} failed: ${errMsg}${diagnosis}`)
          if (failedCount === totalServices) {
            console.error('[proxy-selector] All IP check services failed - proxy may be unreachable or authentication failed')
            console.error(`[proxy-selector] Diagnostic: username=${username ? username.substring(0, 20) + '...' : '(empty)'}, password=${password ? '***' : '(empty)'}`)
            resolve(null)
          }
        }
      }
    })
  })
}

/**
 * 测试代理连接是否可用（降级模式使用）
 * 尝试通过代理访问简单的 URL，验证代理能正常工作
 */
export async function testProxyConnectivity(
  proxy: SingleRequestProxy,
  username: string,
  password: string
): Promise<boolean> {
  // 构建 SOCKS5 代理 URL
  const proxyUrl = proxy.url.replace(/^socks5?:\/\//, '')
  const encodedUsername = username ? encodeURIComponent(username) : ''
  const encodedPassword = password ? encodeURIComponent(password) : ''
  const authPart = encodedUsername || encodedPassword
    ? `${encodedUsername}:${encodedPassword}@`
    : ''
  const fullProxyUrl = `socks5://${authPart}${proxyUrl}`

  console.log(`[proxy-selector] Connectivity test with username: ${username}`)

  // 并行测试多个 URL，任意一个成功即可
  return new Promise((resolve) => {
    let resolved = false
    let failedCount = 0
    const totalUrls = CONNECTIVITY_TEST_URLS.length

    CONNECTIVITY_TEST_URLS.forEach(async (testUrl) => {
      const agent = new SocksProxyAgent(fullProxyUrl, { timeout: CONNECTIVITY_TEST_TIMEOUT })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), CONNECTIVITY_TEST_TIMEOUT)

      try {
        const response = await fetch(testUrl, {
          agent: agent as unknown as import('http').Agent,
          signal: controller.signal as unknown as AbortSignal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        })

        clearTimeout(timeout)

        if (!resolved && response.ok) {
          resolved = true
          console.log(`[proxy-selector] Connectivity test passed via ${testUrl}`)
          resolve(true)
        } else if (!resolved) {
          failedCount++
          console.log(`[proxy-selector] Connectivity test failed for ${testUrl}: HTTP ${response.status}`)
          if (failedCount === totalUrls) {
            console.error('[proxy-selector] All connectivity tests failed')
            resolve(false)
          }
        }
      } catch (err) {
        clearTimeout(timeout)
        if (!resolved) {
          failedCount++
          const errMsg = err instanceof Error ? err.message : String(err)
          console.log(`[proxy-selector] Connectivity test failed for ${testUrl}: ${errMsg}`)
          if (failedCount === totalUrls) {
            console.error('[proxy-selector] All connectivity tests failed')
            resolve(false)
          }
        }
      }
    })
  })
}

// ============================================
// 代理选择核心函数
// ============================================

/**
 * 获取用户可用的代理供应商列表
 */
export async function getAvailableProxies(
  userId: string,
  countryCode: string,
  campaignId?: string
): Promise<ProxySelectionContext | null> {
  try {
    // 1. 获取该用户可用的代理供应商列表（通过多对多关联表）
    const proxyProviders = await prisma.proxyProvider.findMany({
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
        priority: 'asc', // 优先级从小到大（0 = 最高优先级）
      },
    })

    if (proxyProviders.length === 0) {
      console.log(`[proxy-selector] No proxy providers assigned to user ${userId}`)
      // 额外诊断：检查是否有启用的代理供应商
      const totalEnabled = await prisma.proxyProvider.count({
        where: { enabled: true, deletedAt: null },
      })
      console.log(`[proxy-selector] Total enabled proxy providers in system: ${totalEnabled}`)
      // 检查用户的分配记录
      const userAssignments = await prisma.proxyProviderUser.count({
        where: { userId: userId },
      })
      console.log(`[proxy-selector] User ${userId} has ${userAssignments} proxy assignments in ProxyProviderUser table`)
      return null
    }

    // 打印每个代理供应商的详细信息
    console.log(`[proxy-selector] Found ${proxyProviders.length} proxy providers for user ${userId}:`)
    proxyProviders.forEach((p, i) => {
      console.log(`[proxy-selector]   ${i + 1}. ${p.name}: ${p.host}:${p.port}, template: ${p.usernameTemplate}, enabled: ${p.enabled}`)
    })

    // 2. 获取24小时内已使用的出口 IP 列表
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const usedProxies = campaignId
      ? await prisma.proxyExitIpUsage.findMany({
          where: {
            userId: userId,
            campaignId: campaignId,
            usedAt: {
              gte: twentyFourHoursAgo,
            },
          },
          select: {
            exitIp: true,
          },
        })
      : []

    const usedIpSet = new Set(usedProxies.map(p => p.exitIp))
    console.log(`[proxy-selector] ${usedIpSet.size} exit IPs used in last 24h for campaign ${campaignId}`)

    return {
      userId,
      countryCode,
      campaignId,
      usedIpSet,
      providers: proxyProviders,
      currentIndex: 0,
      triedProxies: [],
    }
  } catch (err) {
    console.error('[proxy-selector] Failed to get proxy providers from database:', err)
    return null
  }
}

/**
 * 从上下文中获取下一个可用代理配置
 */
export function getNextProxyConfig(context: ProxySelectionContext): ProxyConfig | null {
  while (context.currentIndex < context.providers.length) {
    const provider = context.providers[context.currentIndex]
    context.currentIndex++

    // 构建用户名（支持模板变量替换）
    const username = processUsernameTemplate(provider.usernameTemplate || '', context.countryCode)

    // 密码直接使用明文（不再加解密）
    const password = provider.password || undefined

    // 构建代理配置（使用 SOCKS5 协议）
    const proxy: SingleRequestProxy = {
      url: `socks5://${provider.host}:${provider.port}`,
      username: username || undefined,
      password: password,
      protocol: 'socks5',
    }

    console.log(`[proxy-selector] Trying proxy: ${provider.name} (priority=${provider.priority}, host=${provider.host}:${provider.port})`)
    console.log(`[proxy-selector]   Template: ${provider.usernameTemplate}`)
    console.log(`[proxy-selector]   Country: ${context.countryCode} → Username: ${username}`)
    console.log(`[proxy-selector]   Password: ${password ? '***' + password.slice(-4) : '(none)'}`)

    return { provider, proxy, username }
  }

  return null
}

/**
 * 选择一个可用的代理（带出口 IP 去重）
 * 
 * 流程：
 * 1. 按优先级遍历代理供应商
 * 2. 获取每个代理的实际出口 IP（用于 24 小时去重）
 * 3. 检查出口 IP 是否24小时内已使用
 * 4. 返回第一个可用的代理
 * 
 * 改进：如果 IP 检测失败，仍然返回代理配置（跳过去重），让调用方决定是否使用
 */
export async function selectAvailableProxy(
  context: ProxySelectionContext
): Promise<ProxySelectionResult> {
  const triedProxies: TriedProxy[] = []
  
  // 第一轮：尝试找到能获取 IP 且 IP 未被使用的代理
  let proxyConfig: ProxyConfig | null
  const startIndex = context.currentIndex
  
  while ((proxyConfig = getNextProxyConfig(context)) !== null) {
    const { provider, proxy, username } = proxyConfig
    
    try {
      console.log(`[proxy-selector] Attempting proxy: ${provider.name}`)

      // 获取代理的实际出口 IP（使用已解密的密码）
      const exitIpInfo = await getProxyExitIp(proxy, username, proxy.password || '')
      
      if (!exitIpInfo) {
        console.log(`[proxy-selector] Failed to get exit IP for ${provider.name}, will try without IP check`)
        triedProxies.push({
          providerName: provider.name,
          host: provider.host,
          priority: provider.priority,
          success: false,
          failReason: '无法获取出口 IP（将尝试跳过 IP 检测）',
        })
        continue
      }
      
      // 检查出口 IP 是否在24小时内已使用
      if (context.usedIpSet.has(exitIpInfo.ip)) {
        console.log(`[proxy-selector] Exit IP ${exitIpInfo.ip} already used in 24h, trying next proxy...`)
        triedProxies.push({
          providerName: provider.name,
          host: `${exitIpInfo.ip}${exitIpInfo.country ? ` (${exitIpInfo.country})` : ''}`,
          priority: provider.priority,
          success: false,
          exitIp: exitIpInfo.ip,
          failReason: `出口 IP ${exitIpInfo.ip} 24h内已使用`,
        })
        continue
      }
      
      // 找到可用的代理
      triedProxies.push({
        providerName: provider.name,
        host: `${exitIpInfo.ip}${exitIpInfo.country ? ` (${exitIpInfo.country})` : ''}`,
        priority: provider.priority,
        success: true,
        exitIp: exitIpInfo.ip,
      })
      
      return {
        success: true,
        proxyConfig,
        exitIpInfo,
        triedProxies: [...context.triedProxies, ...triedProxies],
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[proxy-selector] Proxy ${provider.name} error:`, errorMessage)
      
      triedProxies.push({
        providerName: provider.name,
        host: provider.host,
        priority: provider.priority,
        success: false,
        failReason: errorMessage,
      })
    }
  }
  
  // 第一轮全部失败，第二轮：跳过 IP 检测，但先测试代理连接是否可用
  console.log(`[proxy-selector] All proxies failed IP check, trying fallback mode with connectivity test...`)
  
  // 重置索引，从头开始
  context.currentIndex = startIndex
  
  while ((proxyConfig = getNextProxyConfig(context)) !== null) {
    const { provider, proxy, username } = proxyConfig
    console.log(`[proxy-selector] Fallback: testing connectivity for ${provider.name}`)
    
    // 测试代理连接是否可用
    const isConnectable = await testProxyConnectivity(proxy, username, proxy.password || '')
    
    if (isConnectable) {
      console.log(`[proxy-selector] Fallback: ${provider.name} is connectable, using it`)
      
      // 生成一个随机 IP 作为占位符（不会用于去重记录）
      const fallbackExitIp: ExitIpInfo = {
        ip: `unknown-${Date.now()}`,
        country: context.countryCode,
      }
      
      triedProxies.push({
        providerName: provider.name,
        host: provider.host,
        priority: provider.priority,
        success: true,
        failReason: '降级模式：连接测试通过，跳过 IP 验证',
      })
      
      return {
        success: true,
        proxyConfig,
        exitIpInfo: fallbackExitIp,
        triedProxies: [...context.triedProxies, ...triedProxies],
      }
    } else {
      console.log(`[proxy-selector] Fallback: ${provider.name} connectivity test failed`)
      triedProxies.push({
        providerName: provider.name,
        host: provider.host,
        priority: provider.priority,
        success: false,
        failReason: '降级模式：连接测试失败',
      })
    }
  }
  
  // 所有代理都失败
  return {
    success: false,
    triedProxies: [...context.triedProxies, ...triedProxies],
    error: '所有代理供应商均不可用（IP 检测和连接测试均失败）',
  }
}

/**
 * 记录代理出口 IP 使用（用于24小时去重）
 */
export async function recordProxyUsage(
  userId: string,
  campaignId: string,
  exitIp: string
): Promise<void> {
  try {
    await prisma.proxyExitIpUsage.create({
      data: {
        userId,
        campaignId,
        exitIp,
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24小时后过期
      },
    })
    console.log(`[proxy-selector] Recorded exit IP usage: ${exitIp} for campaign ${campaignId}`)
  } catch (err) {
    // 记录失败不影响主流程
    console.error('[proxy-selector] Failed to record proxy usage:', err)
  }
}

/**
 * 清理过期的代理 IP 使用记录
 */
export async function cleanupExpiredProxyUsage(): Promise<number> {
  const result = await prisma.proxyExitIpUsage.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  })

  if (result.count > 0) {
    console.log(`[proxy-selector] Cleaned up ${result.count} expired IP usage records`)
  }

  return result.count
}

