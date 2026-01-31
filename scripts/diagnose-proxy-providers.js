/**
 * 代理供应商诊断脚本（方案B）
 *
 * 用法：
 *   node scripts/diagnose-proxy-providers.js
 */

const fs = require('fs')
const path = require('path')
const dns = require('dns')
const net = require('net')
const { PrismaClient } = require('@prisma/client')

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

function looksEncrypted(value) {
  if (!value) return false
  const parts = value.split(':')
  if (parts.length !== 3) return false
  return parts.every(part => /^[0-9a-f]+$/i.test(part))
}

function containsSpecialChars(value) {
  if (!value) return false
  return /[@:#/?]/.test(value)
}

async function checkHost(host) {
  if (net.isIP(host)) {
    return { ok: true, addresses: [host] }
  }
  try {
    const records = await dns.promises.lookup(host, { all: true })
    return { ok: true, addresses: records.map(r => r.address) }
  } catch (error) {
    return { ok: false, error: error.message || String(error) }
  }
}

async function main() {
  loadEnvFromFile()
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL 未配置，请先设置环境变量或 .env 文件')
  }

  const prisma = new PrismaClient()
  try {
    const providers = await prisma.proxyProvider.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        enabled: true,
        host: true,
        port: true,
        usernameTemplate: true,
        password: true,
      },
      orderBy: { priority: 'asc' },
    })

    if (providers.length === 0) {
      console.log('未找到代理供应商')
      return
    }

    for (const provider of providers) {
      console.log('\n==============================')
      console.log(`[Provider] ${provider.name} (${provider.id})`)
      console.log(`- enabled: ${provider.enabled}`)
      console.log(`- host: ${provider.host}:${provider.port}`)
      console.log(`- usernameTemplate: ${provider.usernameTemplate || '(empty)'}`)

      const hostCheck = await checkHost(provider.host)
      if (hostCheck.ok) {
        console.log(`- DNS: OK (${hostCheck.addresses.join(', ')})`)
      } else {
        console.log(`- DNS: FAIL (${hostCheck.error})`)
      }

      const hasPassword = Boolean(provider.password)
      const encrypted = looksEncrypted(provider.password || '')
      console.log(`- password: ${hasPassword ? (encrypted ? 'encrypted' : 'plain/legacy') : 'empty'}`)

      if (!encrypted && containsSpecialChars(provider.password || '')) {
        console.log('- warning: 密码包含特殊字符，可能需要 URL 编码')
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error('[Error]', error.message || error)
  process.exit(1)
})

