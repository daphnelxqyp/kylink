/**
 * 测试联盟链接追踪脚本
 * 
 * 逐个测试各 Campaign 的联盟链接是否可以通过代理追踪
 * 
 * 运行方式：
 * npx ts-node --compiler-options '{"module":"commonjs"}' scripts/test-affiliate-links.ts
 */

import { PrismaClient } from '@prisma/client'
import { SocksProxyAgent } from 'socks-proxy-agent'

// 使用 Next.js 内置的 node-fetch
const fetch = require('next/dist/compiled/node-fetch')

const prisma = new PrismaClient()

// 解密密码（简化版，直接返回原值）
function decryptPassword(encrypted: string): string {
  // 如果是旧格式（未加密），直接返回
  if (!encrypted.includes(':')) {
    return encrypted
  }
  // 这里简化处理，实际需要使用 encryption.ts 的解密逻辑
  return encrypted
}

// 处理用户名模板
function processUsernameTemplate(template: string, countryCode: string): string {
  if (!template) return ''
  
  const generateRandom = (len: number) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }
  
  return template
    .replace(/\{country\}/gi, countryCode.toLowerCase())
    .replace(/\{COUNTRY\}/g, countryCode.toUpperCase())
    .replace(/\{random:(\d+)\}/gi, (_, len) => generateRandom(parseInt(len)))
}

interface TestResult {
  campaignId: string
  country: string
  affiliateDomain: string
  proxyName: string
  exitIp?: string
  success: boolean
  statusCode?: number
  finalUrl?: string
  error?: string
  duration: number
}

// 从 HTML 中提取 JavaScript 跳转 URL
function extractJsRedirect(html: string, baseUrl: string): string | null {
  // location.href = "url"
  const patterns = [
    /(?:window\.|document\.)?location\.href\s*=\s*["'`]([^"'`]+)["'`]/gi,
    /(?:window\.|document\.)?location\.replace\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gi,
    /(?:window\.|document\.)?location\s*=\s*["'`]([^"'`]+)["'`]/gi,
  ]
  
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    const match = pattern.exec(html)
    if (match && match[1]) {
      try {
        // 解析相对 URL
        const url = new URL(match[1], baseUrl)
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          return url.href
        }
      } catch {
        // 忽略无效 URL
      }
    }
  }
  return null
}

// 从 HTML 中提取 Meta Refresh URL
function extractMetaRefresh(html: string, baseUrl: string): string | null {
  const pattern = /<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\d+\s*;\s*url\s*=\s*["']?([^"'\s>]+)/gi
  pattern.lastIndex = 0
  const match = pattern.exec(html)
  if (match && match[1]) {
    try {
      const url = new URL(match[1], baseUrl)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.href
      }
    } catch {
      // 忽略无效 URL
    }
  }
  return null
}

async function testAffiliateLink(
  affiliateUrl: string,
  proxyHost: string,
  proxyPort: number,
  username: string,
  password: string,
  proxyName: string,
  campaignId: string,
  country: string
): Promise<TestResult> {
  const startTime = Date.now()
  const affiliateDomain = new URL(affiliateUrl).hostname
  
  try {
    // 构建 SOCKS5 代理
    const proxyUrl = `socks5://${username}:${password}@${proxyHost}:${proxyPort}`
    const agent = new SocksProxyAgent(proxyUrl, { timeout: 20000 })
    
    console.log(`   🔄 测试: ${affiliateDomain} via ${proxyName}...`)
    
    // 先获取代理出口 IP
    let exitIp: string | undefined
    try {
      const ipResponse = await fetch('https://ipinfo.io/json', {
        agent: agent as unknown as import('http').Agent,
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      if (ipResponse.ok) {
        const ipData = await ipResponse.json()
        exitIp = ipData.ip
        console.log(`      代理出口 IP: ${exitIp}`)
      }
    } catch {
      console.log(`      ⚠️ 无法获取出口 IP`)
    }
    
    // 完整追踪重定向链路
    let currentUrl = affiliateUrl
    let redirectCount = 0
    const maxRedirects = 10
    const visitedUrls: string[] = []
    
    while (redirectCount < maxRedirects) {
      visitedUrls.push(currentUrl)
      
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      
      let response
      let html = ''
      
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          agent: agent as unknown as import('http').Agent,
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': redirectCount === 0 ? 'https://t.co' : visitedUrls[redirectCount - 1],
          },
        })
        
        clearTimeout(timeout)
      } catch (err) {
        clearTimeout(timeout)
        throw err
      }
      
      const statusCode = response.status
      const currentDomain = new URL(currentUrl).hostname
      console.log(`      [${redirectCount + 1}] ${currentDomain} → ${statusCode}`)
      
      // HTTP 重定向
      if (statusCode >= 300 && statusCode < 400) {
        const location = response.headers.get('location')
        if (location) {
          try {
            currentUrl = new URL(location, currentUrl).href
            redirectCount++
            continue
          } catch {
            break
          }
        }
        break
      }
      
      // 成功响应，检查 HTML 中的跳转
      if (statusCode === 200) {
        try {
          html = await response.text()
        } catch {
          break
        }
        
        // 检查 Meta Refresh
        const metaUrl = extractMetaRefresh(html, currentUrl)
        if (metaUrl && !visitedUrls.includes(metaUrl)) {
          console.log(`      [${redirectCount + 1}] Meta refresh → ${new URL(metaUrl).hostname}`)
          currentUrl = metaUrl
          redirectCount++
          continue
        }
        
        // 检查 JavaScript 跳转
        const jsUrl = extractJsRedirect(html, currentUrl)
        if (jsUrl && !visitedUrls.includes(jsUrl)) {
          console.log(`      [${redirectCount + 1}] JS redirect → ${new URL(jsUrl).hostname}`)
          currentUrl = jsUrl
          redirectCount++
          continue
        }
        
        // 没有更多跳转
        break
      }
      
      // 错误响应
      if (statusCode >= 400) {
        const duration = Date.now() - startTime
        return {
          campaignId,
          country,
          affiliateDomain,
          proxyName,
          exitIp,
          success: false,
          statusCode,
          error: `HTTP ${statusCode} at ${currentDomain}`,
          duration,
        }
      }
      
      break
    }
    
    const duration = Date.now() - startTime
    const finalDomain = new URL(currentUrl).hostname
    console.log(`      ✅ 完成! 最终: ${finalDomain} (${redirectCount} 次跳转, ${duration}ms)`)
    
    return {
      campaignId,
      country,
      affiliateDomain,
      proxyName,
      exitIp,
      success: true,
      statusCode: 200,
      finalUrl: currentUrl,
      duration,
    }
    
  } catch (err) {
    const duration = Date.now() - startTime
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.log(`      ❌ 错误: ${errorMsg.substring(0, 100)}`)
    
    return {
      campaignId,
      country,
      affiliateDomain,
      proxyName,
      success: false,
      error: errorMsg,
      duration,
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  🔍 联盟链接追踪测试')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('')

  try {
    // 1. 获取测试用户
    const user = await prisma.user.findFirst({
      where: { email: 'test@kyads.com', deletedAt: null },
    })
    
    if (!user) {
      console.log('❌ 找不到测试用户')
      return
    }
    
    // 2. 获取用户的代理供应商
    const proxyProviders = await prisma.proxyProvider.findMany({
      where: {
        enabled: true,
        deletedAt: null,
        assignedUsers: { some: { userId: user.id } },
      },
      orderBy: { priority: 'asc' },
    })
    
    console.log(`📊 找到 ${proxyProviders.length} 个代理供应商`)
    for (const p of proxyProviders) {
      console.log(`   - ${p.name} (${p.host}:${p.port})`)
    }
    console.log('')
    
    // 3. 获取所有符合条件的 Campaign
    const campaigns = await prisma.campaignMeta.findMany({
      where: {
        userId: user.id,
        status: 'active',
        deletedAt: null,
        country: { not: null },
        NOT: { country: '' },
      },
    })
    
    // 4. 为每个 Campaign 获取联盟链接
    const testCases: Array<{
      campaignId: string
      country: string
      affiliateUrl: string
    }> = []
    
    for (const c of campaigns) {
      const link = await prisma.affiliateLink.findFirst({
        where: { userId: user.id, campaignId: c.campaignId, enabled: true, deletedAt: null },
      })
      if (link) {
        testCases.push({
          campaignId: c.campaignId,
          country: c.country || 'US',
          affiliateUrl: link.url,
        })
      }
    }
    
    console.log(`📋 找到 ${testCases.length} 个待测试的联盟链接`)
    console.log('')
    
    // 5. 逐个测试
    const results: TestResult[] = []
    
    for (const testCase of testCases) {
      console.log(`───────────────────────────────────────────────────────────`)
      console.log(`🎯 Campaign: ${testCase.campaignId} [${testCase.country}]`)
      console.log(`   URL: ${testCase.affiliateUrl.substring(0, 70)}...`)
      
      // 使用第一个代理进行测试
      const proxy = proxyProviders[0]
      if (!proxy) {
        console.log('   ⚠️ 没有可用代理')
        continue
      }
      
      const username = processUsernameTemplate(proxy.usernameTemplate || '', testCase.country)
      const password = decryptPassword(proxy.password || '')
      
      const result = await testAffiliateLink(
        testCase.affiliateUrl,
        proxy.host,
        proxy.port,
        username,
        password,
        proxy.name,
        testCase.campaignId,
        testCase.country
      )
      
      results.push(result)
      
      // 添加延迟避免请求过快
      await new Promise(r => setTimeout(r, 2000))
    }
    
    // 6. 输出汇总
    console.log('')
    console.log('═══════════════════════════════════════════════════════════')
    console.log('  📊 测试结果汇总')
    console.log('═══════════════════════════════════════════════════════════')
    
    const successResults = results.filter(r => r.success)
    const failResults = results.filter(r => !r.success)
    
    console.log(`   成功: ${successResults.length}`)
    console.log(`   失败: ${failResults.length}`)
    console.log('')
    
    if (failResults.length > 0) {
      console.log('❌ 失败的联盟链接：')
      for (const r of failResults) {
        console.log(`   - [${r.country}] ${r.campaignId} (${r.affiliateDomain})`)
        console.log(`     错误: ${r.error?.substring(0, 100)}`)
      }
    }
    
    if (successResults.length > 0) {
      console.log('')
      console.log('✅ 成功的联盟链接：')
      for (const r of successResults) {
        console.log(`   - [${r.country}] ${r.campaignId} (${r.affiliateDomain}) → ${r.statusCode}`)
      }
    }
    
    // 按域名分组统计
    console.log('')
    console.log('📊 按联盟平台分组：')
    const domainStats = new Map<string, { success: number; fail: number }>()
    for (const r of results) {
      const stats = domainStats.get(r.affiliateDomain) || { success: 0, fail: 0 }
      if (r.success) {
        stats.success++
      } else {
        stats.fail++
      }
      domainStats.set(r.affiliateDomain, stats)
    }
    
    for (const [domain, stats] of domainStats.entries()) {
      const status = stats.fail === 0 ? '✅' : (stats.success === 0 ? '❌' : '⚠️')
      console.log(`   ${status} ${domain}: ${stats.success} 成功, ${stats.fail} 失败`)
    }

  } catch (error) {
    console.error('❌ 脚本执行失败:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then(() => {
    console.log('')
    console.log('🎉 测试完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('脚本执行失败:', error)
    process.exit(1)
  })

