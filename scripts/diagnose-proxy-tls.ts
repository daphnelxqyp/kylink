/**
 * 代理 TLS 连接诊断脚本
 * 
 * 用于诊断代理通过 SOCKS5 访问 HTTPS 站点时 TLS 握手失败的问题
 * 
 * 测试内容：
 * 1. 代理基础连接测试（通过 IP 检测服务）
 * 2. 不同 HTTPS 站点的 TLS 连接测试
 * 3. 直连 vs 代理对比测试
 * 4. TLS 参数和超时测试
 * 
 * 使用方法：
 * npx tsx scripts/diagnose-proxy-tls.ts
 */

import { SocksProxyAgent } from 'socks-proxy-agent'
import https from 'https'
import http from 'http'
import tls from 'tls'
import dns from 'dns'
import { promisify } from 'util'

// ============================================
// 配置
// ============================================

// 代理配置（从日志中提取）
const PROXY_CONFIG = {
  host: 'as.cbeb09223deff7d4.abcproxy.vip',
  port: 4950,
  // 如果需要认证，填写这里
  username: '',
  password: '',
}

// 目标站点（问题站点）
const PROBLEM_URL = 'https://track.flexlinkspro.com/g.ashx?foid=156074.17472&trid=1241899.230661&foc=17&fot=9999&fos=1&url=https%3A%2F%2Fwww.hero.co%2F&fobs=test123'

// 对照测试站点
const TEST_URLS = [
  { name: 'httpbin (HTTP)', url: 'http://httpbin.org/ip' },
  { name: 'httpbin (HTTPS)', url: 'https://httpbin.org/ip' },
  { name: 'ipinfo.io', url: 'https://ipinfo.io/json' },
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'Amazon', url: 'https://www.amazon.com' },
  { name: 'CloudFlare', url: 'https://1.1.1.1/cdn-cgi/trace' },
  { name: 'flexlinkspro (主域)', url: 'https://www.flexlinkspro.com' },
  { name: 'flexlinkspro (track)', url: PROBLEM_URL },
]

// 测试超时配置
const TIMEOUTS = [5000, 10000, 15000, 30000]

// ============================================
// 工具函数
// ============================================

const dnsLookup = promisify(dns.lookup)

function printHeader(title: string) {
  console.log('\n' + '='.repeat(60))
  console.log(`  ${title}`)
  console.log('='.repeat(60))
}

function printResult(label: string, success: boolean, detail: string) {
  const icon = success ? '✅' : '❌'
  console.log(`${icon} ${label}: ${detail}`)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

// 使用原生 https/http 模块发起请求
function makeRequest(
  url: string,
  options: {
    agent?: https.Agent | http.Agent | SocksProxyAgent
    timeout?: number
    followRedirect?: boolean
  } = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const isHttps = parsedUrl.protocol === 'https:'
    const client = isHttps ? https : http
    
    const requestOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      agent: options.agent,
      timeout: options.timeout || 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      },
      rejectUnauthorized: false, // 测试时忽略证书
    }
    
    const req = client.request(requestOptions, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body,
        })
      })
    })
    
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
    
    req.end()
  })
}

// ============================================
// 测试 1: DNS 解析测试
// ============================================

async function testDNS(): Promise<void> {
  printHeader('测试 1: DNS 解析')
  
  const domains = [
    PROXY_CONFIG.host,
    'track.flexlinkspro.com',
    'www.flexlinkspro.com',
  ]
  
  for (const domain of domains) {
    try {
      const start = Date.now()
      const result = await dnsLookup(domain)
      const duration = Date.now() - start
      printResult(domain, true, `${result.address} (${formatDuration(duration)})`)
    } catch (err) {
      printResult(domain, false, `DNS解析失败: ${err instanceof Error ? err.message : err}`)
    }
  }
}

// ============================================
// 测试 2: 代理基础连接测试
// ============================================

async function testProxyBasicConnection(): Promise<void> {
  printHeader('测试 2: 代理基础连接 (获取出口IP)')
  
  const proxyUrl = PROXY_CONFIG.username 
    ? `socks5://${PROXY_CONFIG.username}:${PROXY_CONFIG.password}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
    : `socks5://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
  
  console.log(`代理地址: socks5://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`)
  
  const ipServices = [
    { name: 'httpbin (HTTP)', url: 'http://httpbin.org/ip' },
    { name: 'httpbin (HTTPS)', url: 'https://httpbin.org/ip' },
    { name: 'ipinfo.io', url: 'https://ipinfo.io/json' },
  ]
  
  for (const service of ipServices) {
    try {
      const start = Date.now()
      const agent = new SocksProxyAgent(proxyUrl, { timeout: 10000 })
      
      const response = await makeRequest(service.url, { agent, timeout: 10000 })
      const duration = Date.now() - start
      
      if (response.statusCode === 200) {
        try {
          const data = JSON.parse(response.body)
          const ip = data.ip || data.origin
          printResult(service.name, true, `出口IP: ${ip} (${formatDuration(duration)})`)
        } catch {
          printResult(service.name, true, `HTTP 200 (${formatDuration(duration)})`)
        }
      } else {
        printResult(service.name, false, `HTTP ${response.statusCode}`)
      }
    } catch (err) {
      printResult(service.name, false, `${err instanceof Error ? err.message : err}`)
    }
  }
}

// ============================================
// 测试 3: TLS 版本和密码套件测试
// ============================================

async function testTLSVersions(): Promise<void> {
  printHeader('测试 3: TLS 版本测试 (直连 flexlinkspro)')
  
  const hostname = 'track.flexlinkspro.com'
  const tlsVersions: Array<{ name: string; options: tls.ConnectionOptions }> = [
    { name: 'TLS 自动', options: {} },
    { name: 'TLS 1.2', options: { maxVersion: 'TLSv1.2', minVersion: 'TLSv1.2' } },
    { name: 'TLS 1.3', options: { maxVersion: 'TLSv1.3', minVersion: 'TLSv1.3' } },
  ]
  
  for (const tlsConfig of tlsVersions) {
    try {
      const start = Date.now()
      
      const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const opts: tls.ConnectionOptions = {
          host: hostname,
          port: 443,
          servername: hostname, // SNI
          rejectUnauthorized: false, // 测试时忽略证书验证
          timeout: 10000,
          ...tlsConfig.options,
        }
        
        const sock = tls.connect(opts, () => {
          resolve(sock)
        })
        
        sock.on('error', reject)
        sock.setTimeout(10000, () => {
          sock.destroy()
          reject(new Error('Connection timeout'))
        })
      })
      
      const duration = Date.now() - start
      const protocol = socket.getProtocol()
      const cipher = socket.getCipher()
      
      printResult(tlsConfig.name, true, `协议: ${protocol}, 密码套件: ${cipher?.name} (${formatDuration(duration)})`)
      
      socket.destroy()
    } catch (err) {
      printResult(tlsConfig.name, false, `${err instanceof Error ? err.message : err}`)
    }
  }
}

// ============================================
// 测试 4: 代理 + 不同站点 TLS 测试
// ============================================

async function testProxyWithDifferentSites(): Promise<void> {
  printHeader('测试 4: 代理访问不同 HTTPS 站点')
  
  const proxyUrl = PROXY_CONFIG.username 
    ? `socks5://${PROXY_CONFIG.username}:${PROXY_CONFIG.password}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
    : `socks5://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
  
  for (const site of TEST_URLS) {
    try {
      const start = Date.now()
      const agent = new SocksProxyAgent(proxyUrl, { timeout: 15000 })
      
      const response = await makeRequest(site.url, { agent, timeout: 15000 })
      const duration = Date.now() - start
      
      printResult(site.name, true, `HTTP ${response.statusCode} (${formatDuration(duration)})`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      
      // 分类错误
      let category = '未知错误'
      if (errorMsg.includes('TLS') || errorMsg.includes('SSL') || errorMsg.includes('secure')) {
        category = 'TLS/SSL 错误'
      } else if (errorMsg.includes('abort') || errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
        category = '超时'
      } else if (errorMsg.includes('ECONNREFUSED')) {
        category = '连接被拒'
      } else if (errorMsg.includes('ENOTFOUND')) {
        category = 'DNS 错误'
      } else if (errorMsg.includes('socket') || errorMsg.includes('Socket')) {
        category = '套接字错误'
      }
      
      printResult(site.name, false, `[${category}] ${errorMsg}`)
    }
  }
}

// ============================================
// 测试 5: 直连 vs 代理对比
// ============================================

async function testDirectVsProxy(): Promise<void> {
  printHeader('测试 5: 直连 vs 代理对比 (flexlinkspro)')
  
  const url = 'https://track.flexlinkspro.com'
  
  // 测试直连
  console.log('\n--- 直连测试 ---')
  try {
    const start = Date.now()
    const agent = new https.Agent({ rejectUnauthorized: false })
    
    const response = await makeRequest(url, { agent, timeout: 15000 })
    const duration = Date.now() - start
    
    printResult('直连', true, `HTTP ${response.statusCode} (${formatDuration(duration)})`)
  } catch (err) {
    printResult('直连', false, `${err instanceof Error ? err.message : err}`)
  }
  
  // 测试代理
  console.log('\n--- 代理测试 ---')
  const proxyUrl = PROXY_CONFIG.username 
    ? `socks5://${PROXY_CONFIG.username}:${PROXY_CONFIG.password}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
    : `socks5://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
  
  try {
    const start = Date.now()
    const agent = new SocksProxyAgent(proxyUrl, { timeout: 15000 })
    
    const response = await makeRequest(url, { agent, timeout: 15000 })
    const duration = Date.now() - start
    
    printResult('代理', true, `HTTP ${response.statusCode} (${formatDuration(duration)})`)
  } catch (err) {
    printResult('代理', false, `${err instanceof Error ? err.message : err}`)
  }
}

// ============================================
// 测试 6: 不同超时配置测试
// ============================================

async function testDifferentTimeouts(): Promise<void> {
  printHeader('测试 6: 不同超时配置 (代理 + flexlinkspro)')
  
  const url = 'https://track.flexlinkspro.com'
  const proxyUrl = PROXY_CONFIG.username 
    ? `socks5://${PROXY_CONFIG.username}:${PROXY_CONFIG.password}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
    : `socks5://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
  
  for (const timeout of TIMEOUTS) {
    try {
      const start = Date.now()
      const agent = new SocksProxyAgent(proxyUrl, { timeout })
      
      const response = await makeRequest(url, { agent, timeout })
      const duration = Date.now() - start
      
      printResult(`超时 ${timeout}ms`, true, `HTTP ${response.statusCode} (${formatDuration(duration)})`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      printResult(`超时 ${timeout}ms`, false, errorMsg)
    }
  }
}

// ============================================
// 测试 7: 检测目标站点证书信息
// ============================================

async function testCertificateInfo(): Promise<void> {
  printHeader('测试 7: 目标站点证书信息')
  
  const hostname = 'track.flexlinkspro.com'
  
  try {
    const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const opts: tls.ConnectionOptions = {
        host: hostname,
        port: 443,
        servername: hostname,
        rejectUnauthorized: false,
        timeout: 10000,
      }
      
      const sock = tls.connect(opts, () => {
        resolve(sock)
      })
      
      sock.on('error', reject)
      sock.setTimeout(10000, () => {
        sock.destroy()
        reject(new Error('Connection timeout'))
      })
    })
    
    const cert = socket.getPeerCertificate()
    
    console.log(`\n证书信息:`)
    console.log(`  - 主题: ${cert.subject?.CN || 'N/A'}`)
    console.log(`  - 颁发者: ${cert.issuer?.CN || 'N/A'}`)
    console.log(`  - 有效期: ${cert.valid_from} ~ ${cert.valid_to}`)
    console.log(`  - 指纹: ${cert.fingerprint}`)
    console.log(`  - 序列号: ${cert.serialNumber}`)
    
    if (cert.subjectaltname) {
      console.log(`  - SAN: ${cert.subjectaltname}`)
    }
    
    socket.destroy()
    printResult('证书检查', true, '证书有效')
  } catch (err) {
    printResult('证书检查', false, `${err instanceof Error ? err.message : err}`)
  }
}

// ============================================
// 测试 8: 代理认证测试
// ============================================

async function testProxyAuth(): Promise<void> {
  printHeader('测试 8: 代理认证配置')
  
  // 测试无认证
  console.log('\n--- 无认证 ---')
  try {
    const proxyUrl = `socks5://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
    const agent = new SocksProxyAgent(proxyUrl, { timeout: 10000 })
    
    const response = await makeRequest('http://httpbin.org/ip', { agent, timeout: 10000 })
    
    if (response.statusCode === 200) {
      try {
        const data = JSON.parse(response.body)
        printResult('无认证', true, `出口IP: ${data.origin}`)
      } catch {
        printResult('无认证', true, `HTTP 200`)
      }
    } else {
      printResult('无认证', false, `HTTP ${response.statusCode}`)
    }
  } catch (err) {
    printResult('无认证', false, `${err instanceof Error ? err.message : err}`)
  }
  
  // 如果配置了认证，测试有认证
  if (PROXY_CONFIG.username && PROXY_CONFIG.password) {
    console.log('\n--- 有认证 ---')
    try {
      const proxyUrl = `socks5://${PROXY_CONFIG.username}:${PROXY_CONFIG.password}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`
      const agent = new SocksProxyAgent(proxyUrl, { timeout: 10000 })
      
      const response = await makeRequest('http://httpbin.org/ip', { agent, timeout: 10000 })
      
      if (response.statusCode === 200) {
        try {
          const data = JSON.parse(response.body)
          printResult('有认证', true, `出口IP: ${data.origin}`)
        } catch {
          printResult('有认证', true, `HTTP 200`)
        }
      } else {
        printResult('有认证', false, `HTTP ${response.statusCode}`)
      }
    } catch (err) {
      printResult('有认证', false, `${err instanceof Error ? err.message : err}`)
    }
  }
}

// ============================================
// 主程序
// ============================================

async function main() {
  console.log('🔍 代理 TLS 连接诊断工具')
  console.log('=' .repeat(60))
  console.log(`目标代理: socks5://${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`)
  console.log(`问题URL: ${PROBLEM_URL.substring(0, 60)}...`)
  console.log(`诊断时间: ${new Date().toISOString()}`)
  
  try {
    await testDNS()
    await testProxyBasicConnection()
    await testTLSVersions()
    await testProxyWithDifferentSites()
    await testDirectVsProxy()
    await testDifferentTimeouts()
    await testCertificateInfo()
    await testProxyAuth()
    
    printHeader('诊断总结')
    console.log(`
根据以上测试结果，请检查：

1. 如果"代理基础连接"失败 → 代理本身有问题
2. 如果直连成功但代理失败 → 代理对特定站点有限制
3. 如果 HTTP 成功但 HTTPS 失败 → TLS 穿透问题
4. 如果增加超时后成功 → 网络延迟问题
5. 如果所有 HTTPS 站点都失败 → 代理 TLS 配置问题

建议的下一步：
- 如果代理本身正常但特定站点失败 → 尝试切换代理供应商
- 如果是超时问题 → 增加超时配置
- 如果是 TLS 问题 → 检查代理是否支持 TLS 1.3
`)
  } catch (err) {
    console.error('\n诊断过程出错:', err)
  }
}

main().catch(console.error)
