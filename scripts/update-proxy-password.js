/**
 * 更新代理供应商密码（会自动加密后存库）
 *
 * 用法：
 *   node scripts/update-proxy-password.js --provider-id <PROVIDER_ID> --password "<NEW_PASSWORD>"
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
    if (arg === '--provider-id') args.providerId = argv[i + 1]
    if (arg === '--password') args.password = argv[i + 1]
  }
  return args
}

async function main() {
  loadEnvFromFile()
  const args = parseArgs(process.argv.slice(2))
  const providerId = args.providerId
  const password = args.password

  if (!providerId || !password) {
    throw new Error('缺少参数：--provider-id 和 --password 必须提供')
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL 未配置，请先设置环境变量或 .env 文件')
  }

  const prisma = new PrismaClient()
  try {
    const provider = await prisma.proxyProvider.findFirst({
      where: { id: providerId, deletedAt: null },
      select: { id: true, name: true },
    })

    if (!provider) {
      throw new Error('代理供应商不存在或已删除')
    }

    // 内置加密逻辑（与 src/lib/encryption.ts 保持一致，避免 require TS 文件失败）
    const crypto = require('crypto')
    const ALGORITHM = 'aes-256-cbc'
    const IV_LENGTH = 16
    const KEY_LENGTH = 32
    const SALT_LENGTH = 16
    const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'kyads-default-secret-key-change-in-production'

    function deriveKey(secret, salt) {
      return crypto.scryptSync(secret, salt, KEY_LENGTH)
    }

    function encrypt(plaintext) {
      if (!plaintext) return ''
      const salt = crypto.randomBytes(SALT_LENGTH)
      const iv = crypto.randomBytes(IV_LENGTH)
      const key = deriveKey(ENCRYPTION_SECRET, salt)
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return `${salt.toString('hex')}:${iv.toString('hex')}:${encrypted.toString('hex')}`
    }

    const encrypted = encrypt(password)

    await prisma.proxyProvider.update({
      where: { id: providerId },
      data: { password: encrypted },
    })

    console.log(`已更新代理密码：${provider.name} (${provider.id})`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error('[Error]', error.message || error)
  process.exit(1)
})
