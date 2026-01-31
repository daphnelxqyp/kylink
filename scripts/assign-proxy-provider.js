/**
 * 代理供应商分配脚本
 *
 * 用法：
 *   node scripts/assign-proxy-provider.js --list
 *   node scripts/assign-proxy-provider.js --user-id <USER_ID> --assign-all
 *   node scripts/assign-proxy-provider.js --user-id <USER_ID> --provider-ids <ID1,ID2,...>
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
    if (arg === '--list') args.list = true
    if (arg === '--assign-all') args.assignAll = true
    if (arg === '--user-id') args.userId = argv[i + 1]
    if (arg === '--provider-ids') args.providerIds = argv[i + 1]
  }
  return args
}

async function listData(prisma) {
  const [users, providers] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, email: true, name: true, status: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.proxyProvider.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        enabled: true,
        priority: true,
        assignedUserId: true,
        assignedUsers: { select: { userId: true } },
      },
      orderBy: { priority: 'asc' },
    }),
  ])

  console.log('\n[Users]')
  console.log(JSON.stringify(users, null, 2))
  console.log('\n[ProxyProviders]')
  console.log(JSON.stringify(providers, null, 2))
}

async function assignProviders(prisma, userId, providerIds) {
  const uniqueProviderIds = Array.from(new Set(providerIds)).filter(Boolean)
  if (uniqueProviderIds.length === 0) {
    throw new Error('未提供有效的代理供应商 ID')
  }

  const assignments = uniqueProviderIds.map(proxyProviderId => ({
    proxyProviderId,
    userId,
  }))

  const created = await prisma.proxyProviderUser.createMany({
    data: assignments,
    skipDuplicates: true,
  })

  const updated = await prisma.proxyProvider.updateMany({
    where: { id: { in: uniqueProviderIds }, assignedUserId: null },
    data: { assignedUserId: userId },
  })

  console.log('\n[Assign Result]')
  console.log(`- 新增分配记录: ${created.count}`)
  console.log(`- 更新 assignedUserId: ${updated.count}`)
}

async function main() {
  loadEnvFromFile()
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL 未配置，请先设置环境变量或 .env 文件')
  }

  const args = parseArgs(process.argv.slice(2))
  const prisma = new PrismaClient()

  try {
    if (args.list) {
      await listData(prisma)
      return
    }

    if (!args.userId) {
      throw new Error('缺少 --user-id 参数')
    }

    let providerIds = []
    if (args.assignAll) {
      const providers = await prisma.proxyProvider.findMany({
        where: { deletedAt: null, enabled: true },
        select: { id: true },
      })
      providerIds = providers.map(p => p.id)
    } else if (args.providerIds) {
      providerIds = args.providerIds.split(',').map(id => id.trim()).filter(Boolean)
    }

    await assignProviders(prisma, args.userId, providerIds)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error('[Error]', error.message || error)
  process.exit(1)
})

