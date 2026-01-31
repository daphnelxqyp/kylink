/**
 * 清空用户可用库存（仅清空 available 状态）
 *
 * 用法：
 *   node scripts/clear-stock-for-user.js --user-id <USER_ID>
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

  const prisma = new PrismaClient()
  try {
    const result = await prisma.suffixStockItem.deleteMany({
      where: {
        userId,
        status: 'available',
        deletedAt: null,
      },
    })

    console.log(`[Stock] 已清空可用库存: ${result.count} 条 (userId=${userId})`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error('[Error]', error.message || error)
  process.exit(1)
})
