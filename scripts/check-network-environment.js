/**
 * 网络环境诊断脚本
 *
 * 用途：
 * - 检测当前公网出口 IP 与国家/地区
 * - 简单判断是否处在“境外/境内”环境（仅供参考）
 * - 可选检测代理主机 DNS 与 TCP 可达性
 *
 * 用法：
 *   node scripts/check-network-environment.js
 *   node scripts/check-network-environment.js --check-proxy-hosts
 */

const dns = require('dns')
const net = require('net')
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')

function loadEnvFromFile() {
  if (process.env.DATABASE_URL) return
  const envPath = path.join(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return

  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    const rawValue = trimmed.slice(index + 1).trim()
    const value = rawValue.replace(/^['"]|['"]$/g, '')
    if (key === 'DATABASE_URL' && value) {
      process.env.DATABASE_URL = value
      break
    }
  }
}

function parseArgs(argv) {
  const args = { checkProxyHosts: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check-proxy-hosts') args.checkProxyHosts = true
  }
  return args
}

async function queryGeo(url, parser) {
  const res = await fetch(url, { headers: { 'User-Agent': 'kyads-network-check' } })
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  const data = await res.json()
  return parser(data)
}

async function getGeoInfo() {
  const providers = [
    {
      name: 'ipinfo.io',
      url: 'https://ipinfo.io/json',
      parse: data => ({
        ip: data.ip,
        country: data.country,
        region: data.region,
        city: data.city,
        source: 'ipinfo.io',
      }),
    },
    {
      name: 'ipapi.co',
      url: 'https://ipapi.co/json/',
      parse: data => ({
        ip: data.ip,
        country: data.country_code,
        region: data.region,
        city: data.city,
        source: 'ipapi.co',
      }),
    },
    {
      name: 'ip-api.com',
      url: 'http://ip-api.com/json',
      parse: data => ({
        ip: data.query,
        country: data.countryCode,
        region: data.regionName,
        city: data.city,
        source: 'ip-api.com',
      }),
    },
  ]

  const errors = []
  for (const provider of providers) {
    try {
      return await queryGeo(provider.url, provider.parse)
    } catch (error) {
      errors.push(`${provider.name}: ${error.message || error}`)
    }
  }
  throw new Error(`Geo lookup failed: ${errors.join(' | ')}`)
}

async function checkHost(host, port, timeoutMs = 4000) {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
  let resolvedIp = host
  if (!ipv4Regex.test(host)) {
    const result = await dns.promises.lookup(host)
    resolvedIp = result.address
  }

  const ok = await new Promise(resolve => {
    const socket = net.createConnection({ host: resolvedIp, port }, () => {
      socket.destroy()
      resolve(true)
    })
    socket.setTimeout(timeoutMs)
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => resolve(false))
  })

  return { host, resolvedIp, port, ok }
}

async function checkProxyHosts() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL 未配置，跳过代理主机检测')
    return
  }
  const prisma = new PrismaClient()
  try {
    const providers = await prisma.proxyProvider.findMany({
      where: { deletedAt: null, enabled: true },
      select: { name: true, host: true, port: true },
      orderBy: { priority: 'asc' },
    })

    if (providers.length === 0) {
      console.log('未找到启用的代理供应商')
      return
    }

    console.log('\n[Proxy Host Reachability]')
    for (const provider of providers) {
      try {
        const result = await checkHost(provider.host, provider.port)
        console.log(`- ${provider.name}: ${result.ok ? 'OK' : 'FAIL'} (${result.resolvedIp}:${result.port})`)
      } catch (error) {
        console.log(`- ${provider.name}: FAIL (${error.message || error})`)
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  loadEnvFromFile()
  const args = parseArgs(process.argv.slice(2))

  const geo = await getGeoInfo()
  console.log('[Network Geo]')
  console.log(`- IP: ${geo.ip}`)
  console.log(`- Country: ${geo.country || 'unknown'}`)
  console.log(`- Region: ${geo.region || 'unknown'}`)
  console.log(`- City: ${geo.city || 'unknown'}`)
  console.log(`- Source: ${geo.source}`)

  if (geo.country) {
    console.log(`- Note: 当前出口国家为 ${geo.country}。部分代理要求特定国家/地区。`)
  }

  if (args.checkProxyHosts) {
    await checkProxyHosts()
  }
}

main().catch(error => {
  console.error('[Error]', error.message || error)
  process.exit(1)
})
