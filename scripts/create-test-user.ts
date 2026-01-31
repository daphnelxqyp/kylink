/**
 * 创建/重置测试用户脚本
 *
 * 运行方式:
 * 1) 创建默认测试用户
 *    npx ts-node --compiler-options '{"module":"commonjs"}' scripts/create-test-user.ts
 *
 * 2) 创建管理员测试用户（仅名称区分，不含角色权限）
 *    npx ts-node --compiler-options '{"module":"commonjs"}' scripts/create-test-user.ts --admin
 *
 * 3) 重置指定用户的 API Key（如果已存在）
 *    npx ts-node --compiler-options '{"module":"commonjs"}' scripts/create-test-user.ts --reset --email admin@kyads.com
 */

import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'

const prisma = new PrismaClient()

// 生成 API Key
function generateApiKey(isTest: boolean = false): string {
  const prefix = isTest ? 'ky_test_' : 'ky_live_'
  const randomPart = createHash('sha256')
    .update(Math.random().toString() + Date.now().toString())
    .digest('hex')
    .substring(0, 32)
  return prefix + randomPart
}

// 计算 API Key 哈希值
function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

async function main() {
  const isAdmin = process.argv.includes('--admin')
  const forceReset = process.argv.includes('--reset')
  const email = getArgValue('--email') || (isAdmin ? 'admin@kyads.com' : 'test@kyads.com')
  const name = getArgValue('--name') || (isAdmin ? '管理员测试用户' : '测试用户')

  // 检查是否已有用户
  const existingUser = await prisma.user.findFirst({
    where: {
      email,
      deletedAt: null,
    },
  })

  if (existingUser) {
    if (!forceReset) {
      console.log('⚠️ 用户已存在')
      console.log('用户 ID:', existingUser.id)
      console.log('API Key 前缀:', existingUser.apiKeyPrefix)
      console.log('\n❌ 无法显示完整 API Key（数据库只存储哈希值）')
      console.log('💡 如需新 API Key，请使用 --reset 重新生成')
      return
    }

    // 生成新 API Key 并更新
    const apiKey = generateApiKey(true)
    const apiKeyHash = hashApiKey(apiKey)
    const apiKeyPrefix = apiKey.substring(0, 12)

    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name,
        apiKeyHash,
        apiKeyPrefix,
        apiKeyCreatedAt: new Date(),
        status: 'active',
        deletedAt: null,
      },
    })

    console.log('✅ API Key 已重置')
    console.log('================================')
    console.log('用户 ID:', existingUser.id)
    console.log('邮箱:', email)
    console.log('API Key:', apiKey)
    console.log('API Key 前缀:', apiKeyPrefix)
    console.log('================================')
    console.log('\n📝 请保存 API Key，后续测试需要使用')
    return
  }

  // 生成 API Key
  const apiKey = generateApiKey(true) // 使用测试前缀
  const apiKeyHash = hashApiKey(apiKey)
  const apiKeyPrefix = apiKey.substring(0, 12)

  // 创建用户
  const user = await prisma.user.create({
    data: {
      email,
      name,
      apiKeyHash,
      apiKeyPrefix,
      apiKeyCreatedAt: new Date(),
      spreadsheetId: 'test-spreadsheet-id',
      status: 'active',
    },
  })

  console.log('✅ 测试用户创建成功！')
  console.log('================================')
  console.log('用户 ID:', user.id)
  console.log('邮箱:', user.email)
  console.log('API Key:', apiKey)
  console.log('API Key 前缀:', apiKeyPrefix)
  console.log('================================')
  console.log('\n📝 请保存 API Key，后续测试需要使用')
  console.log('\n使用方式:')
  console.log(`curl -X POST http://localhost:51001/api/v1/campaigns/sync \\`)
  console.log(`  -H "Authorization: Bearer ${apiKey}" \\`)
  console.log(`  -H "Content-Type: application/json" \\`)
  console.log(`  -d '{"campaigns": [...], "syncMode": "incremental"}'`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

