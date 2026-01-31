/**
 * 管理端用户管理
 *
 * GET  /v1/admin/users  - 获取用户列表
 * POST /v1/admin/users  - 创建用户并生成 API Key
 */

import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { generateApiKey, hashApiKey, hashPasswordBcrypt, validateApiKeyFormat } from '@/lib/auth'
import { normalizeSpreadsheetIds, parseSpreadsheetIds, serializeSpreadsheetIds } from '@/lib/spreadsheet-ids'
import { errorResponse, parseJsonBody, successResponse, validateRequired } from '@/lib/utils'

interface AdminCreateUserRequest {
  email: string
  name?: string
  status?: 'active' | 'suspended'
  role?: 'ADMIN' | 'USER'
  apiKey?: string
  password?: string
  spreadsheetIds?: string[] | string
  spreadsheetId?: string
}

function isValidEmail(email: string): boolean {
  return email.includes('@')
}

function mapAdminUser(user: {
  id: string
  email: string | null
  name: string | null
  status: string
  role: string
  apiKeyPrefix: string
  apiKeyCreatedAt: Date | null
  spreadsheetId: string | null
  createdAt: Date
  updatedAt: Date
}) {
  const { spreadsheetId, ...rest } = user
  return {
    ...rest,
    spreadsheetIds: parseSpreadsheetIds(spreadsheetId),
  }
}

export async function GET(request: NextRequest) {
  try {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        role: true,
        apiKeyPrefix: true,
        apiKeyCreatedAt: true,
        spreadsheetId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    const normalizedUsers = users.map(user => mapAdminUser(user))
    return successResponse({ users: normalizedUsers, total: users.length })
  } catch (error) {
    console.error('Admin users list error:', error)
    return errorResponse('INTERNAL_ERROR', '获取用户列表失败', 500)
  }
}

export async function POST(request: NextRequest) {
  const { data, error: parseError } = await parseJsonBody<AdminCreateUserRequest>(request)
  if (parseError) {
    return errorResponse('VALIDATION_ERROR', parseError, 422)
  }

  const { valid, missing } = validateRequired(data || {}, ['email', 'password'])
  if (!valid) {
    return errorResponse('VALIDATION_ERROR', `缺少必填字段: ${missing.join(', ')}`, 422)
  }

  const email = data!.email.trim()
  if (!isValidEmail(email)) {
    return errorResponse('VALIDATION_ERROR', 'email 格式不正确', 422)
  }

  const name = data?.name?.trim() || null
  const status = data?.status === 'suspended' ? 'suspended' : 'active'
  const role = data?.role === 'ADMIN' ? 'ADMIN' : 'USER'
  const password = data?.password?.trim() || ''
  const providedApiKey = data?.apiKey?.trim()
  const spreadsheetIds = normalizeSpreadsheetIds(data?.spreadsheetIds ?? data?.spreadsheetId)

  if (!password) {
    return errorResponse('VALIDATION_ERROR', 'password 不能为空', 422)
  }

  if (password.length < 6) {
    return errorResponse('VALIDATION_ERROR', 'password 至少需要 6 位', 422)
  }

  if (providedApiKey && !validateApiKeyFormat(providedApiKey)) {
    return errorResponse('VALIDATION_ERROR', 'apiKey 格式不正确', 422)
  }

  try {
    const existingUser = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    })

    if (existingUser) {
      return errorResponse('CONFLICT', '用户已存在，请直接编辑或重置 API Key', 409)
    }

    const apiKey = providedApiKey || generateApiKey(false)
    const apiKeyHash = hashApiKey(apiKey)
    const apiKeyPrefix = apiKey.substring(0, 12)
    const passwordHash = hashPasswordBcrypt(password)

    const created = await prisma.user.create({
      data: {
        email,
        name,
        status,
        role,
        apiKeyHash,
        apiKeyPrefix,
        apiKeyCreatedAt: new Date(),
        passwordHash,
        spreadsheetId: serializeSpreadsheetIds(spreadsheetIds),
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        role: true,
        apiKeyPrefix: true,
        apiKeyCreatedAt: true,
        spreadsheetId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return successResponse(
      {
        user: mapAdminUser(created),
        apiKey,
        mode: 'created',
      },
      201
    )
  } catch (error) {
    console.error('Admin create user error:', error)
    return errorResponse('INTERNAL_ERROR', '创建用户失败', 500)
  }
}

