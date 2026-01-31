/**
 * 创建/更新代理供应商（带可选用户分配）
 *
 * 用法：
 *   node scripts/create-proxy-provider.js \
 *     --name "<NAME>" \
 *     --host "<HOST>" \
 *     --port 1080 \
 *     --username "<USERNAME>" \
 *     --password "<PASSWORD>" \
 *     --priority 0 \
 *     --assign-user-id "<USER_ID>"
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
      break
    }
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--name') args.name = argv[i + 1]
    if (arg === '--host') args.host = argv[i + 1]
    if (arg === '--port') args.port = argv[i + 1]
    if (arg === '--username') args.username = argv[i + 1]
    if (arg === '--password') args.password = argv[i + 1]
    if (arg === '--priority') args.priority = argv[i + 1]
    if (arg === '--assign-user-id') args.assignUserId = argv[i + 1]
    if (arg === '--enabled') args.enabled = argv[i + 1]
  }
  return args
}

function encryptPassword(plaintext) {
  if (!plaintext) return ''
  const crypto = require('crypto')
  const ALGORITHM = 'aes-256-cbc'
  const IV_LENGTH = 16
  const KEY_LENGTH = 32
  const SALT_LENGTH = 16
  const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'kyads-default-secret-key-change-in-production'

  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = crypto.scryptSync(ENCRYPTION_SECRET, salt, KEY_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${salt.toString('hex')}:${iv.toString('hex')}:${encrypted.toString('hex')}`
}

async function main() {
  loadEnvFromFile()
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL 未配置，请先设置环境变量或 .env 文件')
  }

  const args = parseArgs(process.argv.slice(2))
  const name = (args.name || '').trim()
  const host = (args.host || '').trim()
  const port = Number(args.port)
  const username = (args.username || '').trim()
  const password = (args.password || '').trim()
  const priority = Number.isFinite(Number(args.priority)) ? Number(args.priority) : 0
  const enabled = args.enabled === undefined ? true : String(args.enabled) !== 'false'
  const assignUserId = (args.assignUserId || '').trim()

  if (!name || !host || !port || !username || !password) {
    throw new Error('缺少参数：name/host/port/username/password 为必填')
  }

  const prisma = new PrismaClient()
  try {
    const encrypted = encryptPassword(password)

    const existing = await prisma.proxyProvider.findFirst({
      where: { host, port, deletedAt: null },
      select: { id: true, name: true },
    })

    const provider = existing
      ? await prisma.proxyProvider.update({
          where: { id: existing.id },
          data: {
            name,
            host,
            port,
            usernameTemplate: username,
            password: encrypted,
            priority,
            enabled,
          },
          select: { id: true, name: true },
        })
      : await prisma.proxyProvider.create({
          data: {
            name,
            host,
            port,
            usernameTemplate: username,
            password: encrypted,
            priority,
            enabled,
          },
          select: { id: true, name: true },
        })

    if (assignUserId) {
      await prisma.$transaction(async tx => {
        await tx.proxyProviderUser.createMany({
          data: [{ proxyProviderId: provider.id, userId: assignUserId }],
          skipDuplicates: true,
        })
        await tx.proxyProvider.update({
          where: { id: provider.id },
          data: { assignedUserId: assignUserId },
        })
      })
    }

    console.log(`[ProxyProvider] ${existing ? 'Updated' : 'Created'}: ${provider.name} (${provider.id})`)
    if (assignUserId) {
      console.log(`[ProxyProvider] Assigned to user: ${assignUserId}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error('[Error]', error.message || error)
  process.exit(1)
})
