/**
 * API Key 鉴权模块
 * 
 * 实现 PRD 5.1 节定义的鉴权机制：
 * - 从 Authorization Header 提取 API Key
 * - 计算 SHA256 哈希值
 * - 查询数据库验证用户
 * - 返回 userId 用于后续业务隔离
 */

import { createHash, pbkdf2Sync, randomBytes } from 'crypto'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from './prisma'

// API Key 前缀定义
export const API_KEY_PREFIX = {
  LIVE: 'ky_live_',
  TEST: 'ky_test_',
} as const

// 鉴权结果类型
export interface AuthResult {
  success: boolean
  userId?: string
  error?: {
    code: string
    message: string
    status: number
  }
}

// 鉴权上下文（注入到请求中）
export interface AuthContext {
  userId: string
  apiKeyPrefix: string
}

/**
 * 计算 API Key 的 SHA256 哈希值
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

/**
 * 生成新的 API Key
 * 格式：ky_live_ + 32位随机字符
 */
export function generateApiKey(isTest: boolean = false): string {
  const prefix = isTest ? API_KEY_PREFIX.TEST : API_KEY_PREFIX.LIVE
  const randomPart = createHash('sha256')
    .update(Math.random().toString() + Date.now().toString())
    .digest('hex')
    .substring(0, 32)
  return prefix + randomPart
}

/**
 * 生成密码哈希（PBKDF2）- 旧版，保持兼容
 */
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex')
  return { hash, salt }
}

/**
 * 使用 bcrypt 哈希密码（用于新认证系统）
 */
export function hashPasswordBcrypt(password: string): string {
  return bcrypt.hashSync(password, 10)
}

/**
 * 验证 bcrypt 密码
 */
export function verifyPasswordBcrypt(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash)
}

/**
 * 验证密码（兼容旧 PBKDF2 和新 bcrypt）
 */
export function verifyPassword(password: string, hash: string, salt: string | null): boolean {
  // 如果有 salt，使用旧的 PBKDF2 方式验证
  if (salt) {
    const computedHash = pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex')
    return computedHash === hash
  }
  // 否则使用 bcrypt 验证
  return bcrypt.compareSync(password, hash)
}

/**
 * 从请求中提取 API Key
 */
export function extractApiKey(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization')
  
  if (!authHeader) {
    return null
  }
  
  // 支持 Bearer Token 格式
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7)
  }
  
  return null
}

/**
 * 验证 API Key 格式
 */
export function validateApiKeyFormat(apiKey: string): boolean {
  // 检查前缀
  const hasValidPrefix = 
    apiKey.startsWith(API_KEY_PREFIX.LIVE) || 
    apiKey.startsWith(API_KEY_PREFIX.TEST)
  
  if (!hasValidPrefix) {
    return false
  }
  
  // 检查长度：前缀(8) + 随机部分(32) = 40
  if (apiKey.length !== 40) {
    return false
  }
  
  return true
}

/**
 * 核心鉴权函数
 * 
 * 流程：
 * 1. 提取 API Key
 * 2. 验证格式
 * 3. 计算哈希
 * 4. 查询数据库
 * 5. 返回用户信息
 */
export async function authenticateRequest(request: NextRequest): Promise<AuthResult> {
  // 1. 提取 API Key
  const apiKey = extractApiKey(request)
  
  if (!apiKey) {
    return {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: '缺少 Authorization 头或 API Key',
        status: 401,
      },
    }
  }
  
  // 2. 验证格式
  if (!validateApiKeyFormat(apiKey)) {
    return {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'API Key 格式无效',
        status: 401,
      },
    }
  }
  
  // 3. 计算哈希
  const apiKeyHash = hashApiKey(apiKey)
  
  // 4. 查询数据库
  try {
    const user = await prisma.user.findFirst({
      where: {
        deletedAt: null, // 软删除过滤
        OR: [
          { apiKeyHash },           // 正常：存储的是 SHA256
          { apiKeyHash: apiKey },   // 兼容：历史数据可能存的是明文
        ],
      },
      select: {
        id: true,
        status: true,
        apiKeyPrefix: true,
        apiKeyHash: true,
      },
    })
    
    // 用户不存在
    if (!user) {
      return {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API Key 无效或已过期',
          status: 401,
        },
      }
    }
    
    // 用户已暂停
    if (user.status === 'suspended') {
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: '账户已被暂停，请联系管理员',
          status: 403,
        },
      }
    }
    
    // 兼容旧数据：如果数据库里存的是明文，自动迁移为哈希
    if (user.apiKeyHash === apiKey) {
      console.log(`[API Key Migration] Starting migration for user ${user.id}`)

      try {
        await prisma.$transaction([
          prisma.user.update({
            where: { id: user.id },
            data: {
              apiKeyHash,
              apiKeyPrefix: apiKey.substring(0, 12),
              apiKeyCreatedAt: new Date(),
            },
          }),
          prisma.auditLog.create({
            data: {
              userId: user.id,
              action: 'api_key_migration',
              resourceType: 'user',
              resourceId: user.id,
              metadata: {
                reason: 'plaintext_to_hash',
                oldPrefix: apiKey.substring(0, 12),
                newPrefix: apiKey.substring(0, 12),
              },
              ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
              userAgent: request.headers.get('user-agent') || null,
              statusCode: 200,
            },
          }),
        ])

        console.log(`[API Key Migration] Successfully migrated API key for user ${user.id}`)
      } catch (migrationError) {
        console.error(`[API Key Migration] Failed to migrate API key for user ${user.id}:`, migrationError)
        // 迁移失败不影响认证，继续处理
      }
    }

    // 5. 鉴权成功
    return {
      success: true,
      userId: user.id,
    }
    
  } catch (error) {
    console.error('Auth error:', error)
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: '鉴权服务异常，请稍后重试',
        status: 500,
      },
    }
  }
}

/**
 * API 路由鉴权包装器
 * 用于简化 API 路由中的鉴权逻辑
 */
export async function withAuth<T>(
  request: NextRequest,
  handler: (userId: string, request: NextRequest) => Promise<T>
): Promise<Response | T> {
  const authResult = await authenticateRequest(request)
  
  if (!authResult.success) {
    return Response.json(
      {
        success: false,
        error: {
          code: authResult.error!.code,
          message: authResult.error!.message,
        },
      },
      { status: authResult.error!.status }
    )
  }
  
  return handler(authResult.userId!, request)
}

