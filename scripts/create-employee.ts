/**
 * 创建/重置员工（普通用户）脚本
 *
 * 运行方式:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/create-employee.ts
 *
 * 可选参数:
 *   --email <email>    指定邮箱（默认: staff@kyads.com）
 *   --password <pwd>   指定密码（默认: Staff123）
 *   --name <name>      指定名称（默认: 员工）
 *   --reset            强制重置已存在的用户
 *
 * 示例:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/create-employee.ts --email staff@example.com --password MySecurePass123
 */

import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// 生成 API Key
function generateApiKey(): string {
  const prefix = 'ky_live_'
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

// 使用 bcrypt 哈希密码
function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10)
}

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

async function main() {
  const email = getArgValue('--email') || 'staff@kyads.com'
  const password = getArgValue('--password') || 'Staff123'
  const name = getArgValue('--name') || '员工'
  const forceReset = process.argv.includes('--reset')

  // 验证密码强度
  if (password.length < 8) {
    console.error('❌ 密码至少需要 8 位')
    process.exit(1)
  }

  // 检查是否已有用户
  const existingUser = await prisma.user.findFirst({
    where: {
      email,
      deletedAt: null,
    },
  })

  if (existingUser) {
    if (!forceReset) {
      console.log('⚠️ 员工用户已存在')
      console.log('用户 ID:', existingUser.id)
      console.log('邮箱:', existingUser.email)
      console.log('角色:', existingUser.role)
      console.log('API Key 前缀:', existingUser.apiKeyPrefix)
      console.log('\n❌ 无法显示完整 API Key（数据库只存储哈希值）')
      console.log('💡 如需重置，请使用 --reset 参数')
      return
    }

    // 生成新 API Key 并更新
    const apiKey = generateApiKey()
    const apiKeyHash = hashApiKey(apiKey)
    const apiKeyPrefix = apiKey.substring(0, 12)
    const passwordHash = hashPassword(password)

    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name,
        role: 'USER',
        apiKeyHash,
        apiKeyPrefix,
        apiKeyCreatedAt: new Date(),
        passwordHash,
        passwordSalt: null, // bcrypt 不需要单独的 salt
        status: 'active',
        deletedAt: null,
      },
    })

    console.log('✅ 员工用户已重置')
    console.log('================================')
    console.log('用户 ID:', existingUser.id)
    console.log('邮箱:', email)
    console.log('密码:', password)
    console.log('角色: USER')
    console.log('API Key:', apiKey)
    console.log('API Key 前缀:', apiKeyPrefix)
    console.log('================================')
    console.log('\n📝 请保存以上信息用于登录')
    return
  }

  // 生成 API Key
  const apiKey = generateApiKey()
  const apiKeyHash = hashApiKey(apiKey)
  const apiKeyPrefix = apiKey.substring(0, 12)
  const passwordHash = hashPassword(password)

  // 创建员工用户
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role: 'USER',
      apiKeyHash,
      apiKeyPrefix,
      apiKeyCreatedAt: new Date(),
      passwordHash,
      passwordSalt: null, // bcrypt 不需要单独的 salt
      spreadsheetId: null,
      status: 'active',
    },
  })

  console.log('✅ 员工用户创建成功！')
  console.log('================================')
  console.log('用户 ID:', user.id)
  console.log('邮箱:', user.email)
  console.log('密码:', password)
  console.log('角色: USER')
  console.log('API Key:', apiKey)
  console.log('API Key 前缀:', apiKeyPrefix)
  console.log('================================')
  console.log('\n📝 请保存以上信息用于登录')
  console.log('\n登录地址: http://localhost:51001/login')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

