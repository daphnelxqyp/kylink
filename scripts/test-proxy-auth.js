/**
 * 代理认证验证脚本（通过 /api/affiliate-configs/verify）
 *
 * 用法：
 *   node scripts/test-proxy-auth.js --user-id <USER_ID>
 */

const fs = require('fs')
const path = require('path')
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
    }
    if (key === 'NEXT_PUBLIC_API_BASE_URL' && value) {
      process.env.NEXT_PUBLIC_API_BASE_URL = value
    }
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--user-id') args.userId = argv[i + 1]
  }
  return args
}

async function main() {
  loadEnvFromFile()
  const args = parseArgs(process.argv.slice(2))
  const userId = args.userId
  if (!userId) {
    throw new Error('缺少 --user-id 参数')
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL 未配置，请先设置环境变量或 .env 文件')
  }

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:51001'
  const prisma = new PrismaClient()

  try {
    const affiliate = await prisma.affiliateLink.findFirst({
      where: { userId, enabled: true, deletedAt: null, NOT: { url: '' } },
      orderBy: { priority: 'desc' },
    })

    if (!affiliate) {
      throw new Error('未找到可用的联盟链接')
    }

    const campaign = await prisma.campaignMeta.findFirst({
      where: { userId, campaignId: affiliate.campaignId, deletedAt: null },
    })

    const countryCode = (campaign?.country || 'US').toUpperCase()
    let targetDomain
    if (campaign?.finalUrl) {
      try {
        targetDomain = campaign.finalUrl.startsWith('http')
          ? new URL(campaign.finalUrl).hostname
          : campaign.finalUrl
      } catch {
        targetDomain = undefined
      }
    }

    const payload = {
      affiliateLink: affiliate.url,
      countryCode,
      targetDomain,
      userId,
      campaignId: affiliate.campaignId,
      maxRedirects: 8,
    }

    const res = await fetch(`${apiBase}/api/affiliate-configs/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const json = await res.json()
    console.log(JSON.stringify({ status: res.status, body: json }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error('[Error]', error.message || error)
  process.exit(1)
})

