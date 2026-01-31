/**
 * 代理追踪功能测试脚本
 *
 * 测试真实的代理选择和重定向追踪流程：
 * 1. 从数据库获取用户分配的代理
 * 2. 通过代理获取出口 IP
 * 3. 通过代理追踪联盟链接重定向
 *
 * 运行方式:
 * npx ts-node --compiler-options '{"module":"commonjs"}' scripts/test-proxy-tracking.ts
 */

import { PrismaClient } from '@prisma/client'
import { SocksProxyAgent } from 'socks-proxy-agent'

const prisma = new PrismaClient()

// 使用 Next.js 编译的 node-fetch
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const fetch = require('next/dist/compiled/node-fetch')

// ============================================
// 测试配置
// ============================================

const TEST_CONFIG = {
  userEmail: 'test@kyads.com',
  countryCode: 'US',
  // 测试用的联盟链接（Amazon）
  testUrl: 'https://www.amazon.com/dp/B09V3KXJPB?tag=test-20',
}

// ============================================
// 工具函数
// ============================================

function log(icon: string, message: string, data?: unknown) {
  console.log(`${icon} ${message}`)
  if (data) {
    if (typeof data === 'string') {
      console.log('   ', data)
    } else {
      console.log('   ', JSON.stringify(data, null, 2).split('\n').join('\n    '))
    }
  }
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(60))
  console.log(`📋 ${title}`)
  console.log('='.repeat(60))
}

// 处理用户名模板
function processUsernameTemplate(template: string, countryCode: string): string {
  if (!template) return ''
  
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const generateRandom = (len: number) => {
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

// 解密密码（简单实现，实际项目应使用 encryption 模块）
function decryptPassword(encrypted: string): string {
  // 如果没有加密，直接返回
  if (!encrypted.includes(':')) return encrypted
  
  try {
    // 简单的 base64 解密（实际项目使用 AES）
    const parts = encrypted.split(':')
    if (parts.length === 3) {
      // 格式: iv:authTag:encrypted
      // 这里简化处理，实际应使用 crypto 解密
      return encrypted // 返回原始值让代理尝试
    }
    return encrypted
  } catch {
    return encrypted
  }
}

// ============================================
// 测试步骤
// ============================================

async function getTestUser() {
  const user = await prisma.user.findFirst({
    where: {
      email: TEST_CONFIG.userEmail,
      deletedAt: null,
    },
  })

  if (!user) {
    throw new Error('测试用户不存在，请先运行 create-test-user.ts')
  }

  return user
}

async function getProxyProviders(userId: string) {
  return await prisma.proxyProvider.findMany({
    where: {
      enabled: true,
      deletedAt: null,
      assignedUsers: {
        some: { userId },
      },
    },
    orderBy: { priority: 'asc' },
  })
}

async function testProxyConnection(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<{ success: boolean; exitIp?: string; error?: string }> {
  const proxyUrl = `socks5://${username}:${password}@${host}:${port}`
  
  const ipCheckServices = [
    { name: 'ipinfo.io', url: 'https://ipinfo.io/json' },
    { name: 'httpbin.org', url: 'http://httpbin.org/ip' },
  ]

  for (const service of ipCheckServices) {
    try {
      const agent = new SocksProxyAgent(proxyUrl, { timeout: 10000 })
      
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      
      const response = await fetch(service.url, {
        agent,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      })
      
      clearTimeout(timeout)
      
      if (response.ok) {
        const data = await response.json()
        const ip = data.ip || (data.origin ? data.origin.split(',')[0]?.trim() : null)
        
        if (ip) {
          return { success: true, exitIp: ip }
        }
      }
    } catch (err) {
      log('⚠️', `${service.name} 失败: ${err instanceof Error ? err.message : err}`)
    }
  }

  return { success: false, error: '所有 IP 检测服务都失败' }
}

async function testRedirectTracking(
  url: string,
  host: string,
  port: number,
  username: string,
  password: string
): Promise<{ success: boolean; redirectChain?: string[]; finalUrl?: string; error?: string }> {
  const proxyUrl = `socks5://${username}:${password}@${host}:${port}`
  const agent = new SocksProxyAgent(proxyUrl, { timeout: 15000 })
  
  const redirectChain: string[] = [url]
  let currentUrl = url
  let maxRedirects = 10
  
  while (maxRedirects > 0) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      
      const response = await fetch(currentUrl, {
        agent,
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
      
      clearTimeout(timeout)
      
      const statusCode = response.status
      
      // 检查是否是重定向
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const location = response.headers.get('location')
        if (location) {
          // 解析相对 URL
          const nextUrl = new URL(location, currentUrl).href
          redirectChain.push(nextUrl)
          currentUrl = nextUrl
          maxRedirects--
          continue
        }
      }
      
      // 非重定向，检查 HTML 中的 meta refresh
      if (statusCode === 200) {
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('text/html')) {
          const body = await response.text()
          
          // 检查 meta refresh
          const metaMatch = body.match(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\d+\s*;\s*url\s*=\s*["']?([^"'\s>]+)/i)
          if (metaMatch && metaMatch[1]) {
            const nextUrl = new URL(metaMatch[1], currentUrl).href
            redirectChain.push(nextUrl)
            currentUrl = nextUrl
            maxRedirects--
            continue
          }
          
          // 检查 JavaScript 重定向
          const jsMatch = body.match(/(?:window\.|document\.)?location(?:\.href)?\s*=\s*["'`]([^"'`]+)["'`]/i)
          if (jsMatch && jsMatch[1] && !jsMatch[1].startsWith('javascript:')) {
            try {
              const nextUrl = new URL(jsMatch[1], currentUrl).href
              if (nextUrl !== currentUrl) {
                redirectChain.push(nextUrl)
                currentUrl = nextUrl
                maxRedirects--
                continue
              }
            } catch {
              // URL 解析失败，忽略
            }
          }
        }
      }
      
      // 到达最终页面
      return {
        success: true,
        redirectChain,
        finalUrl: currentUrl,
      }
      
    } catch (err) {
      return {
        success: false,
        redirectChain,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
  
  return {
    success: true,
    redirectChain,
    finalUrl: currentUrl,
  }
}

// ============================================
// 主函数
// ============================================

async function main() {
  console.log('\n🚀 代理追踪功能测试')
  console.log('='.repeat(60))

  try {
    // 步骤 1: 获取测试用户
    logSection('步骤 1: 获取测试用户')
    const user = await getTestUser()
    log('✅', '测试用户', { id: user.id, email: user.email })

    // 步骤 2: 获取代理供应商
    logSection('步骤 2: 获取代理供应商')
    const providers = await getProxyProviders(user.id)
    
    if (providers.length === 0) {
      log('❌', '没有找到分配给用户的代理供应商')
      process.exit(1)
    }
    
    log('✅', `找到 ${providers.length} 个代理供应商`)

    // 步骤 3: 测试每个代理
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i]
      
      logSection(`步骤 3.${i + 1}: 测试代理 "${provider.name}"`)
      
      log('ℹ️', '代理配置', {
        host: provider.host,
        port: provider.port,
        priority: provider.priority,
        usernameTemplate: provider.usernameTemplate,
      })

      // 处理用户名模板
      const username = processUsernameTemplate(provider.usernameTemplate || '', TEST_CONFIG.countryCode)
      const password = decryptPassword(provider.password || '')
      
      log('ℹ️', '连接参数', {
        username: username.substring(0, 20) + '...',
        passwordLength: password.length,
      })

      // 3.1 测试代理连接和出口 IP
      log('ℹ️', '正在获取出口 IP...')
      const ipResult = await testProxyConnection(provider.host, provider.port, username, password)
      
      if (ipResult.success) {
        log('✅', '代理连接成功', { exitIp: ipResult.exitIp })
      } else {
        log('❌', '代理连接失败', { error: ipResult.error })
        continue
      }

      // 3.2 测试重定向追踪
      log('ℹ️', '正在测试重定向追踪...')
      log('ℹ️', '测试 URL:', TEST_CONFIG.testUrl)
      
      const trackResult = await testRedirectTracking(
        TEST_CONFIG.testUrl,
        provider.host,
        provider.port,
        username,
        password
      )
      
      if (trackResult.success) {
        log('✅', '重定向追踪成功', {
          redirectCount: (trackResult.redirectChain?.length || 1) - 1,
          finalUrl: trackResult.finalUrl?.substring(0, 80) + '...',
        })
        
        if (trackResult.redirectChain && trackResult.redirectChain.length > 1) {
          console.log('\n   重定向链:')
          trackResult.redirectChain.forEach((url, idx) => {
            const prefix = idx === 0 ? '   🔗' : '   ↳ '
            console.log(`${prefix} [${idx}] ${url.substring(0, 70)}${url.length > 70 ? '...' : ''}`)
          })
        }
      } else {
        log('❌', '重定向追踪失败', { error: trackResult.error })
      }
      
      // 只测试第一个成功的代理
      if (ipResult.success && trackResult.success) {
        log('\n✅', '代理测试通过，跳过后续代理')
        break
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log('✅ 代理追踪功能测试完成！')
    console.log('='.repeat(60))

  } catch (error) {
    console.error('\n❌ 测试失败:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

