/**
 * 测试单个 Campaign 补货（测试代理追踪是否正常）
 * 
 * 运行方式：
 * npx ts-node --compiler-options '{"module":"commonjs"}' scripts/test-single-replenish.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ============================================
// 简化版的代理选择和追踪逻辑
// ============================================

import { SocksProxyAgent } from 'socks-proxy-agent'

// 使用 Node.js 内置 fetch
const fetch = require('next/dist/compiled/node-fetch')

interface ProxyConfig {
  host: string
  port: number
  username: string
  password: string
}

interface TrackResult {
  success: boolean
  finalUrl?: string
  exitIp?: string
  error?: string
  duration?: number
}

/**
 * 解密密码（简化版，假设未加密）
 */
function decryptPassword(encrypted: string): string {
  // 如果是加密格式，这里需要解密逻辑
  // 目前假设密码是明文或已知格式
  return encrypted
}

/**
 * 获取代理出口 IP
 */
async function getExitIp(proxyUrl: string): Promise<string | null> {
  try {
    const agent = new SocksProxyAgent(proxyUrl, { timeout: 10000 })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    
    const response = await fetch('https://ipinfo.io/json', {
      agent: agent as unknown,
      signal: controller.signal as unknown,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    })
    
    clearTimeout(timeout)
    
    if (response.ok) {
      const data = await response.json() as Record<string, string>
      return data.ip || null
    }
  } catch (err) {
    console.log(`[getExitIp] 失败: ${err instanceof Error ? err.message : err}`)
  }
  return null
}

/**
 * 追踪联盟链接（简化版，测试代理连接）
 */
async function trackAffiliateLink(
  url: string,
  proxyUrl: string,
  timeout: number = 30000
): Promise<TrackResult> {
  const startTime = Date.now()
  
  try {
    const agent = new SocksProxyAgent(proxyUrl, { timeout })
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    console.log(`[track] 开始追踪: ${url.substring(0, 80)}...`)
    console.log(`[track] 使用代理: ${proxyUrl.replace(/:[^:]+@/, ':***@')}`)
    
    const response = await fetch(url, {
      method: 'GET',
      agent: agent as unknown,
      signal: controller.signal as unknown,
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://t.co',
      },
    })
    
    clearTimeout(timeoutId)
    
    const duration = Date.now() - startTime
    
    // 处理重定向
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      console.log(`[track] 收到重定向 ${response.status} -> ${location?.substring(0, 80)}...`)
      
      return {
        success: true,
        finalUrl: location || url,
        duration,
      }
    }
    
    // 成功响应
    if (response.status >= 200 && response.status < 400) {
      return {
        success: true,
        finalUrl: url,
        duration,
      }
    }
    
    // 错误响应
    return {
      success: false,
      error: `HTTP ${response.status}`,
      duration,
    }
    
  } catch (err) {
    const duration = Date.now() - startTime
    const errorMsg = err instanceof Error ? err.message : String(err)
    
    // 分类错误
    if (errorMsg.includes('abort') || errorMsg.includes('timeout')) {
      return { success: false, error: `TIMEOUT (${timeout}ms)`, duration }
    }
    if (errorMsg.includes('ECONNREFUSED')) {
      return { success: false, error: 'CONNECTION_REFUSED', duration }
    }
    if (errorMsg.includes('CERT') || errorMsg.includes('SSL') || errorMsg.includes('TLS')) {
      return { success: false, error: `SSL_ERROR: ${errorMsg}`, duration }
    }
    
    return { success: false, error: errorMsg, duration }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  🧪 测试单个 Campaign 补货（代理追踪测试）')
  console.log('═══════════════════════════════════════════════════════════')
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
    
    console.log(`📌 用户: ${user.email} (${user.id})`)
    
    // 2. 获取一个符合条件的 Campaign
    const campaign = await prisma.campaignMeta.findFirst({
      where: {
        userId: user.id,
        status: 'active',
        deletedAt: null,
        country: { not: null },
        NOT: { country: '' },
      },
    })
    
    if (!campaign) {
      console.log('❌ 找不到符合条件的 Campaign')
      return
    }
    
    console.log(`📌 Campaign: ${campaign.campaignId} (${campaign.country})`)
    console.log(`   名称: ${campaign.campaignName}`)
    
    // 3. 获取联盟链接
    const affiliateLink = await prisma.affiliateLink.findFirst({
      where: {
        userId: user.id,
        campaignId: campaign.campaignId,
        enabled: true,
        deletedAt: null,
      },
    })
    
    if (!affiliateLink) {
      console.log('❌ 找不到联盟链接')
      return
    }
    
    console.log(`📌 联盟链接: ${affiliateLink.url.substring(0, 80)}...`)
    console.log('')
    
    // 4. 获取代理供应商
    const proxyProviders = await prisma.proxyProvider.findMany({
      where: {
        enabled: true,
        deletedAt: null,
        assignedUsers: { some: { userId: user.id } },
      },
      orderBy: { priority: 'asc' },
    })
    
    if (proxyProviders.length === 0) {
      console.log('❌ 没有可用的代理供应商')
      return
    }
    
    console.log(`📌 找到 ${proxyProviders.length} 个代理供应商`)
    console.log('')
    
    // 5. 逐个测试代理
    for (const provider of proxyProviders) {
      console.log('───────────────────────────────────────────────────────────')
      console.log(`🔧 测试代理: ${provider.name} (${provider.host}:${provider.port})`)
      
      // 构建用户名（替换 {country} 变量）
      const username = (provider.usernameTemplate || '')
        .replace(/\{country\}/gi, (campaign.country || 'US').toLowerCase())
        .replace(/\{COUNTRY\}/g, (campaign.country || 'US').toUpperCase())
        .replace(/\{random:(\d+)\}/gi, () => Math.random().toString(36).substring(2, 8))
      
      const password = decryptPassword(provider.password || '')
      
      // 构建代理 URL
      const proxyUrl = `socks5://${username}:${password}@${provider.host}:${provider.port}`
      
      console.log(`   用户名: ${username}`)
      console.log('')
      
      // 5.1 测试获取出口 IP
      console.log('   📡 获取出口 IP...')
      const exitIp = await getExitIp(proxyUrl)
      
      if (!exitIp) {
        console.log('   ❌ 无法获取出口 IP，跳过此代理')
        continue
      }
      
      console.log(`   ✅ 出口 IP: ${exitIp}`)
      console.log('')
      
      // 5.2 测试追踪联盟链接（使用更长的超时）
      console.log('   🔗 测试追踪联盟链接（超时: 30秒）...')
      const trackResult = await trackAffiliateLink(affiliateLink.url, proxyUrl, 30000)
      
      if (trackResult.success) {
        console.log(`   ✅ 追踪成功！耗时: ${trackResult.duration}ms`)
        console.log(`   📍 最终 URL: ${trackResult.finalUrl?.substring(0, 100)}...`)
        console.log('')
        console.log('🎉 代理测试通过！可以用于补货。')
        break
      } else {
        console.log(`   ❌ 追踪失败: ${trackResult.error}`)
        console.log(`   ⏱️ 耗时: ${trackResult.duration}ms`)
      }
      
      console.log('')
    }
    
  } catch (error) {
    console.error('❌ 测试失败:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then(() => {
    console.log('\n🏁 测试完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('脚本执行失败:', error)
    process.exit(1)
  })

