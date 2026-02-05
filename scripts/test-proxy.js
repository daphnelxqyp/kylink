/**
 * 代理诊断测试脚本
 * 
 * 用于排查 NO_PROXY_AVAILABLE 问题
 * 
 * 运行方式：
 * node scripts/test-proxy.js
 */

// 加载环境变量
const path = require('path')
const fs = require('fs')

// 尝试加载不同的 .env 文件
const envFiles = ['.env', '.env.local', '.env.production']
for (const envFile of envFiles) {
  const envPath = path.join(__dirname, '..', envFile)
  if (fs.existsSync(envPath)) {
    console.log(`Loading environment from ${envFile}...`)
    const envContent = fs.readFileSync(envPath, 'utf-8')
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=["']?(.*)["']?$/)
      if (match) {
        const key = match[1].trim()
        let value = match[2].trim()
        // 移除末尾引号
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        if (!process.env[key]) {
          process.env[key] = value
        }
      }
    })
    break
  }
}

// 注意：如果 DATABASE_URL 使用 Docker 容器名 'mysql'，需要在服务器上运行
// 或者使用 --host 参数指定数据库主机地址
if (process.argv.includes('--local')) {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('@mysql:')) {
    const originalUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace('@mysql:', '@localhost:')
    console.log(`Adjusted DATABASE_URL: ${originalUrl.substring(0, 30)}... -> localhost`)
  }
}

const { PrismaClient } = require('@prisma/client')
const { SocksProxyAgent } = require('socks-proxy-agent')
const fetch = require('next/dist/compiled/node-fetch')

const prisma = new PrismaClient()

// IP 检测超时时间（毫秒）
const IP_CHECK_TIMEOUT = 8000

// IP 检测服务列表
const IP_CHECK_SERVICES = [
  {
    name: 'httpbin.org',
    url: 'http://httpbin.org/ip',
    parseResponse: (data) => {
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
    parseResponse: (data) => {
      if (data.ip) {
        return {
          ip: String(data.ip),
          country: data.country ? String(data.country) : undefined,
        }
      }
      return null
    },
  },
]

// 连接测试 URL
const CONNECTIVITY_TEST_URLS = [
  'http://www.google.com/robots.txt',
  'http://httpbin.org/status/200',
]

/**
 * 处理用户名模板
 */
function processUsernameTemplate(template, countryCode) {
  if (!template) return ''
  
  const generateRandom = (length) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }
  
  const generateRandomDigits = (length) => {
    let result = ''
    for (let i = 0; i < length; i++) {
      result += Math.floor(Math.random() * 10).toString()
    }
    return result
  }
  
  return template
    .replace(/\{COUNTRY\}/g, countryCode.toUpperCase())
    .replace(/\{country\}/g, countryCode.toLowerCase())
    .replace(/\{random:(\d+)\}/gi, (_, len) => generateRandom(parseInt(len)))
    .replace(/\{session:(\d+)\}/gi, (_, len) => generateRandomDigits(parseInt(len)))
}

/**
 * 获取代理的实际出口 IP
 */
async function getProxyExitIp(proxy, username, password) {
  const proxyUrl = proxy.url.replace(/^socks5?:\/\//, '')
  const encodedUsername = username ? encodeURIComponent(username) : ''
  const encodedPassword = password ? encodeURIComponent(password) : ''
  const authPart = encodedUsername || encodedPassword
    ? `${encodedUsername}:${encodedPassword}@`
    : ''
  const fullProxyUrl = `socks5://${authPart}${proxyUrl}`

  console.log(`   Testing with proxy URL: socks5://${username ? username + ':***@' : ''}${proxyUrl}`)

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
          agent: agent,
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
        })

        clearTimeout(timeout)

        if (!resolved && response.ok) {
          const data = await response.json()
          const result = service.parseResponse(data)

          if (result && !resolved) {
            resolved = true
            console.log(`   ✓ Got IP from ${service.name}: ${result.ip}${result.country ? ` (${result.country})` : ''}`)
            resolve(result)
          } else if (!resolved) {
            failedCount++
            console.log(`   ✗ ${service.name}: Failed to parse response`)
            if (failedCount === totalServices) resolve(null)
          }
        } else if (!resolved) {
          failedCount++
          console.log(`   ✗ ${service.name}: HTTP ${response.status}`)
          if (failedCount === totalServices) resolve(null)
        }
      } catch (err) {
        clearTimeout(timeout)
        if (!resolved) {
          failedCount++
          const errMsg = err instanceof Error ? err.message : String(err)
          let diagnosis = ''
          if (errMsg.includes('ECONNREFUSED')) {
            diagnosis = ' (代理连接被拒绝)'
          } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('timeout') || errMsg.includes('aborted')) {
            diagnosis = ' (连接超时)'
          } else if (errMsg.includes('ENOTFOUND')) {
            diagnosis = ' (DNS解析失败)'
          } else if (errMsg.includes('SOCKS') || errMsg.includes('authentication')) {
            diagnosis = ' (认证失败)'
          }
          console.log(`   ✗ ${service.name}: ${errMsg.substring(0, 60)}${diagnosis}`)
          if (failedCount === totalServices) resolve(null)
        }
      }
    })
  })
}

/**
 * 测试代理连接是否可用
 */
async function testProxyConnectivity(proxy, username, password) {
  const proxyUrl = proxy.url.replace(/^socks5?:\/\//, '')
  const encodedUsername = username ? encodeURIComponent(username) : ''
  const encodedPassword = password ? encodeURIComponent(password) : ''
  const authPart = encodedUsername || encodedPassword
    ? `${encodedUsername}:${encodedPassword}@`
    : ''
  const fullProxyUrl = `socks5://${authPart}${proxyUrl}`

  return new Promise((resolve) => {
    let resolved = false
    let failedCount = 0
    const totalUrls = CONNECTIVITY_TEST_URLS.length

    CONNECTIVITY_TEST_URLS.forEach(async (testUrl) => {
      const agent = new SocksProxyAgent(fullProxyUrl, { timeout: 10000 })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      try {
        const response = await fetch(testUrl, {
          agent: agent,
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        })

        clearTimeout(timeout)

        if (!resolved && response.ok) {
          resolved = true
          console.log(`   ✓ Connectivity passed via ${testUrl}`)
          resolve(true)
        } else if (!resolved) {
          failedCount++
          if (failedCount === totalUrls) resolve(false)
        }
      } catch (err) {
        clearTimeout(timeout)
        if (!resolved) {
          failedCount++
          if (failedCount === totalUrls) resolve(false)
        }
      }
    })
  })
}

async function main() {
  console.log('='.repeat(60))
  console.log('代理诊断测试脚本')
  console.log('='.repeat(60))
  console.log()

  // 1. 检查数据库中的代理供应商
  console.log('【步骤 1】检查所有代理供应商...')
  const allProviders = await prisma.proxyProvider.findMany({
    where: { deletedAt: null },
    orderBy: { priority: 'asc' },
  })
  
  if (allProviders.length === 0) {
    console.error('❌ 数据库中没有任何代理供应商！')
    console.log('   请先在管理后台添加代理供应商。')
    return
  }
  
  console.log(`✓ 找到 ${allProviders.length} 个代理供应商：`)
  allProviders.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.name}`)
    console.log(`      - ID: ${p.id}`)
    console.log(`      - Host: ${p.host}:${p.port}`)
    console.log(`      - Enabled: ${p.enabled}`)
    console.log(`      - Priority: ${p.priority}`)
    console.log(`      - Username Template: ${p.usernameTemplate || '(无)'}`)
    console.log(`      - Password: ${p.password ? '***' + p.password.slice(-4) : '(无)'}`)
  })
  console.log()

  // 2. 检查启用的代理供应商
  const enabledProviders = allProviders.filter(p => p.enabled)
  console.log('【步骤 2】检查启用的代理供应商...')
  if (enabledProviders.length === 0) {
    console.error('❌ 没有任何启用的代理供应商！')
    console.log('   请在管理后台启用至少一个代理供应商。')
    return
  }
  console.log(`✓ ${enabledProviders.length} 个代理供应商已启用`)
  console.log()

  // 3. 检查用户
  console.log('【步骤 3】检查用户及其代理分配...')
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    include: {
      proxyProviderAssignments: {
        include: {
          proxyProvider: true,
        },
      },
    },
  })
  
  if (users.length === 0) {
    console.error('❌ 数据库中没有任何用户！')
    return
  }
  
  console.log(`✓ 找到 ${users.length} 个用户：`)
  let usersWithoutProxy = []
  let userWithProxy = null
  
  for (const user of users) {
    const assignedProviders = user.proxyProviderAssignments.filter(
      a => a.proxyProvider.enabled && !a.proxyProvider.deletedAt
    )
    console.log(`   - ${user.name || user.email || user.id}`)
    console.log(`     用户 ID: ${user.id}`)
    console.log(`     已分配代理: ${assignedProviders.length} 个`)
    if (assignedProviders.length === 0) {
      console.log(`     ⚠️  该用户没有分配任何代理！`)
      usersWithoutProxy.push(user)
    } else {
      assignedProviders.forEach(a => {
        console.log(`       - ${a.proxyProvider.name}`)
      })
      if (!userWithProxy) {
        userWithProxy = user
      }
    }
  }
  console.log()

  // 4. 检查是否有用户分配了代理
  if (!userWithProxy) {
    console.error('❌ 没有任何用户分配了代理供应商！')
    console.log()
    console.log('【诊断结论】问题原因：用户没有分配代理')
    console.log('   解决方案：')
    console.log('   1. 登录管理后台')
    console.log('   2. 进入「代理管理」页面')
    console.log('   3. 编辑代理供应商，将其分配给需要使用的用户')
    console.log()
    
    // 提供快速修复
    if (usersWithoutProxy.length > 0 && enabledProviders.length > 0) {
      console.log('【快速修复】是否需要自动为用户分配代理？')
      console.log(`   将为用户 "${usersWithoutProxy[0].name || usersWithoutProxy[0].email || usersWithoutProxy[0].id}" 分配代理 "${enabledProviders[0].name}"`)
      console.log()
      console.log('   如需自动修复，请运行：')
      console.log(`   node scripts/test-proxy.js --fix`)
    }
    
    // 检查是否需要自动修复
    if (process.argv.includes('--fix')) {
      console.log()
      console.log('【自动修复】正在为用户分配代理...')
      
      for (const user of usersWithoutProxy) {
        for (const provider of enabledProviders) {
          await prisma.proxyProviderUser.create({
            data: {
              userId: user.id,
              proxyProviderId: provider.id,
            },
          })
          console.log(`   ✓ 已将代理 "${provider.name}" 分配给用户 "${user.name || user.email || user.id}"`)
        }
      }
      
      console.log()
      console.log('✓ 自动修复完成！请重新运行诊断脚本验证。')
    }
    return
  }
  
  console.log('【步骤 4】测试代理连接...')
  console.log(`   使用用户: ${userWithProxy.name || userWithProxy.email || userWithProxy.id}`)
  
  // 测试国家代码
  const testCountry = 'US'
  console.log(`   测试国家: ${testCountry}`)
  console.log()

  // 5. 逐个测试代理
  console.log('【步骤 5】逐个测试代理连接...')
  console.log()
  
  let workingProxies = []
  let failedProxies = []
  
  for (const provider of enabledProviders) {
    console.log(`--- 测试代理: ${provider.name} ---`)
    
    const username = processUsernameTemplate(provider.usernameTemplate || '', testCountry)
    const password = provider.password || ''
    
    console.log(`   Host: ${provider.host}:${provider.port}`)
    console.log(`   Username Template: ${provider.usernameTemplate}`)
    console.log(`   Generated Username: ${username}`)
    console.log(`   Password: ${password ? '***' + password.slice(-4) : '(无)'}`)
    
    const proxy = {
      url: `socks5://${provider.host}:${provider.port}`,
      username: username || undefined,
      password: password || undefined,
      protocol: 'socks5',
    }
    
    // 测试 IP 检测
    console.log('   测试 IP 检测...')
    const exitIpInfo = await getProxyExitIp(proxy, username, password)
    
    if (exitIpInfo) {
      console.log(`   ✓ 代理正常工作！`)
      workingProxies.push(provider.name)
    } else {
      console.log('   IP 检测失败，测试连接可用性...')
      const isConnectable = await testProxyConnectivity(proxy, username, password)
      
      if (isConnectable) {
        console.log('   ✓ 连接测试通过（可使用降级模式）')
        workingProxies.push(provider.name + ' (降级模式)')
      } else {
        console.log('   ✗ 代理完全不可用！')
        failedProxies.push({
          name: provider.name,
          reason: '连接失败或认证失败',
        })
      }
    }
    console.log()
  }
  
  // 总结
  console.log('='.repeat(60))
  console.log('诊断结果')
  console.log('='.repeat(60))
  
  if (workingProxies.length > 0) {
    console.log(`✓ 工作正常的代理: ${workingProxies.join(', ')}`)
  }
  
  if (failedProxies.length > 0) {
    console.log(`✗ 不可用的代理:`)
    failedProxies.forEach(p => {
      console.log(`   - ${p.name}: ${p.reason}`)
    })
  }
  
  if (workingProxies.length === 0) {
    console.log()
    console.log('【问题诊断】所有代理都不可用！')
    console.log('   可能的原因：')
    console.log('   1. 代理服务器地址或端口配置错误')
    console.log('   2. 代理用户名/密码认证失败')
    console.log('   3. 代理服务器不可达（网络问题）')
    console.log('   4. 代理账户已过期或被封禁')
    console.log()
    console.log('   建议检查：')
    console.log('   1. 确认代理供应商账户状态正常')
    console.log('   2. 检查 host/port/username/password 配置是否正确')
    console.log('   3. 确认服务器网络可以访问代理服务器')
  } else if (usersWithoutProxy.length > 0) {
    console.log()
    console.log('【提示】部分用户没有分配代理，如需修复请运行：')
    console.log('   node scripts/test-proxy.js --fix')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
